import fs from 'fs';
import { join } from 'path';
import { createServer } from 'http';
import express, { Request, Response } from 'express';
import { Socket, Server } from 'socket.io';

const app = express();
const server = createServer(app);
const io = new Server(server, { maxHttpBufferSize: 1e8 });
const PORT = 4000;

const text = { data: '' };
const UPLOAD_DIR = join(__dirname, '../public/uploads');

app.use(express.static(join(__dirname, '../public')));

if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

app.get('/', (req: Request, res: Response) => {
  res.sendFile(join(__dirname, '../public', 'index.html'));
});

const activeUploads = new Map<string, { stream: fs.WriteStream; startTime: number }>();

io.on('connection', (socket: Socket) => {
  socket.emit('textChange', text);
  socket.emit('fileListUpdate', getFileList());

  socket.on('textChange', (msg: string) => {
    text.data = msg;
    io.emit('textChange', text);
  });

  socket.on('uploadChunk', (meta: { name: string; chunkIndex: number; totalChunks: number }, data: Buffer, callback?: () => void) => {
    const uploadKey = `${socket.id}_${meta.name}`;
    const filePath = join(UPLOAD_DIR, meta.name);
    
    let upload = activeUploads.get(uploadKey);
    
    if (meta.chunkIndex === 0) {
      const stream = fs.createWriteStream(filePath);
      upload = { stream, startTime: Date.now() };
      activeUploads.set(uploadKey, upload);
    }
    
    if (!upload) {
      callback?.();
      return;
    }
    
    upload.stream.write(Buffer.from(data), (err) => {
      if (meta.chunkIndex === meta.totalChunks - 1) {
        upload!.stream.end();
        activeUploads.delete(uploadKey);
        
        if (!err) {
          io.emit('fileListUpdate', getFileList());
        }
        
        let fileSize = 0;
        try {
          fileSize = fs.statSync(filePath).size;
        } catch (statErr) {
          // ignore
        }
        
        const durationSeconds = (Date.now() - upload!.startTime) / 1000;
        const speedMbps = durationSeconds > 0 ? ((fileSize * 8) / 1_000_000) / durationSeconds : 0;
        
        const timestamp = new Date().toISOString();
        console.log(`[Upload] File: ${meta.name}, Size: ${fileSize} bytes, Speed: ${speedMbps.toFixed(2)} Mbps, Write completed at: ${timestamp}`);
      }
      
      callback?.();
    });
  });

  socket.on('deleteFile', (fileName: string) => {
    const filePath = join(UPLOAD_DIR, fileName);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      io.emit('fileListUpdate', getFileList());
    }
  });

  socket.on('disconnect', () => {
    for (const [key, upload] of activeUploads.entries()) {
      if (key.startsWith(`${socket.id}_`)) {
        upload.stream.end();
        activeUploads.delete(key);
      }
    }
  });
});

function getFileList() {
  return fs.readdirSync(UPLOAD_DIR).map((name) => ({
    name,
    url: `/uploads/${name}`,
  }));
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
