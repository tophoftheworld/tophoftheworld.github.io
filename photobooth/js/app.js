const video = document.getElementById('video');
const canvas = document.getElementById('canvas');
const errorEl = document.getElementById('error');
const ctx = canvas.getContext('2d');

let faceMesh;
let camera;

function showError(message) {
  errorEl.textContent = message;
  errorEl.classList.add('show');
}

function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}

window.addEventListener('resize', resizeCanvas);
resizeCanvas();

function onResults(results) {
  ctx.save();
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0) {
    const landmarks = results.multiFaceLandmarks[0];
    
    const foreheadPoint = landmarks[10];
    
    const x = foreheadPoint.x * canvas.width;
    const y = foreheadPoint.y * canvas.height;
    
    const fontSize = Math.min(canvas.width, canvas.height) * 0.25;
    
    ctx.font = `900 ${fontSize}px "Outfit", sans-serif`;
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = fontSize * 0.08;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    
    ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
    ctx.shadowBlur = 20;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 8;
    
    ctx.strokeText('M', x, y);
    ctx.fillText('M', x, y);
  }

  ctx.restore();
}

async function initCamera() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: 'user',
        width: { ideal: 1920 },
        height: { ideal: 1080 }
      },
      audio: false
    });

    video.srcObject = stream;
    
    await new Promise((resolve) => {
      video.onloadedmetadata = () => {
        video.play();
        resolve();
      };
    });

    faceMesh = new FaceMesh({
      locateFile: (file) => {
        return `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`;
      }
    });

    faceMesh.setOptions({
      maxNumFaces: 1,
      refineLandmarks: true,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5
    });

    faceMesh.onResults(onResults);

    camera = new Camera(video, {
      onFrame: async () => {
        await faceMesh.send({ image: video });
      },
      width: 1920,
      height: 1080
    });

    camera.start();

  } catch (error) {
    console.error('Camera error:', error);
    showError('Please allow camera access and reload the page.');
  }
}

if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
  initCamera();
} else {
  showError('Camera not supported on this device.');
}
