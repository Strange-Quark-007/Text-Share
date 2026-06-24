const socket = io();

const fileInput = document.getElementById('fileInput');
const fileList = document.getElementById('fileList');
let files = [];

// Add paste event listener for automatic image uploads
document.addEventListener('paste', handlePaste);

window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => e.preventDefault());

socket.on('textChange', (text) => {
  const textArea = document.getElementById('textArea');
  textArea.value = text.data;
});

socket.on('fileListUpdate', (filesArr) => {
  files = filesArr;
  renderFileList();
});

function handleTextChange() {
  const textArea = document.getElementById('textArea');
  const text = textArea.value;
  socket.emit('textChange', text);
}

function handleCopy() {
  const textArea = document.getElementById('textArea');
  const cursorStart = textArea.selectionStart;
  const cursorEnd = textArea.selectionEnd;
  textArea.select();
  textArea.setSelectionRange(0, 99999);
  document.execCommand('copy');
  textArea.setSelectionRange(cursorStart, cursorEnd);
  textArea.focus();
}

const CHUNK_SIZE = 10 * 1024 * 1024; // 10 MB

async function uploadFileChunked(file) {
  const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
  const startTime = performance.now();
  
  const display = document.getElementById('speedDisplay');
  if (display) {
    display.textContent = `Uploading "${file.name}": 0%`;
  }
  
  for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
    const start = chunkIndex * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, file.size);
    const chunk = file.slice(start, end);
    const buffer = await chunk.arrayBuffer();
    
    await new Promise((resolve) => {
      socket.emit('uploadChunk', {
        name: file.name,
        chunkIndex,
        totalChunks
      }, new Uint8Array(buffer), () => {
        resolve();
      });
    });

    const percent = Math.round(((chunkIndex + 1) / totalChunks) * 100);
    if (display) {
      display.textContent = `Uploading "${file.name}": ${percent}%`;
    }
  }
  
  const endTime = performance.now();
  const durationSeconds = (endTime - startTime) / 1000;
  const speedMbps = ((file.size * 8) / 1_000_000) / durationSeconds;
  const sizeInMB = file.size / (1024 * 1024);
  
  console.log(`Uploaded ${file.name}: ${sizeInMB.toFixed(2)} MB in ${durationSeconds.toFixed(3)}s (${speedMbps.toFixed(2)} Mbps)`);
  updateSpeedDisplay('upload', speedMbps);
}

async function handleDrop(e) {
  e.preventDefault();
  const selected = Array.from(e.dataTransfer.files);
  for (const file of selected) {
    await uploadFileChunked(file);
  }
}

async function handleUpload(e) {
  const selected = Array.from(e.target.files);
  for (const file of selected) {
    await uploadFileChunked(file);
  }
}

async function handlePaste(e) {
  const items = e.clipboardData?.items;
  if (!items) return;

  for (let item of items) {
    if (item.type.indexOf('image') !== -1) {
      const file = item.getAsFile();
      if (file) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const extension = file.name.split('.').pop() || 'png';
        const fileName = `image-${timestamp}.${extension}`;
        const renamedFile = new File([file], fileName, { type: file.type });
        await uploadFileChunked(renamedFile);
      }
    }
  }
}

async function downloadFile(url, fileName) {
  const encodedFileName = encodeURIComponent(fileName);
  const downloadUrl = `${url}?filename=${encodedFileName}`;

  const startTime = performance.now();
  let loadedBytes = 0;
  
  const display = document.getElementById('speedDisplay');
  if (display) {
    display.textContent = `Downloading "${fileName}": 0%`;
  }
  
  try {
    const response = await fetch(downloadUrl);
    if (!response.ok) throw new Error('Network response was not ok');
    
    const contentLength = +response.headers.get('Content-Length');
    const chunks = [];
    const reader = response.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      loadedBytes += value.length;
      
      if (display) {
        if (contentLength) {
          const percent = Math.round((loadedBytes / contentLength) * 100);
          display.textContent = `Downloading "${fileName}": ${percent}%`;
        } else {
          display.textContent = `Downloading "${fileName}": ${(loadedBytes / (1024 * 1024)).toFixed(1)} MB`;
        }
      }
    }
    const endTime = performance.now();
    const durationSeconds = (endTime - startTime) / 1000;
    const speedMbps = ((loadedBytes * 8) / 1_000_000) / durationSeconds;
    const sizeInMB = loadedBytes / (1024 * 1024);
    
    console.log(`Downloaded ${fileName}: ${sizeInMB.toFixed(2)} MB in ${durationSeconds.toFixed(3)}s (${speedMbps.toFixed(2)} Mbps)`);
    updateSpeedDisplay('download', speedMbps);

    // Trigger the actual <a> tag download using a blob from the fetched chunks
    const blob = new Blob(chunks);
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = fileName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(blobUrl), 100);
  } catch (error) {
    console.error('Failed to measure download speed, falling back to direct download:', error);
    if (display) display.textContent = '';
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = fileName;
    a.click();
  }
}

function handleDownloadAll() {
  if (!files.length) {
    return alert('No files to download.');
  }
  files.forEach(({ url, name }) => downloadFile(url, name));
}

function renderFileList() {
  fileList.innerHTML = '';
  files.forEach((file) => {
    const fileRow = document.createElement('div');
    fileRow.className = 'file-row courier-prime-regular';

    fileRow.innerHTML = `
      <a href="${file.url}" target="_blank" class="file-name"><span>${file.name}</span></a>
      <div class="actions">
        <button class="file-button" onclick="downloadFile('${file.url}', '${file.name}')">
          Download
        </button>
        <button class="file-button delete" onclick="socket.emit('deleteFile', '${file.name}')">
          Delete
        </button>
      </div>
    `;

    fileList.appendChild(fileRow);
  });
}

function updateSpeedDisplay(direction, speedMbps) {
  const display = document.getElementById('speedDisplay');
  if (display) {
    display.textContent = `${direction === 'upload' ? 'Upload' : 'Download'}: ${speedMbps.toFixed(2)} Mbps`;
  }
}
