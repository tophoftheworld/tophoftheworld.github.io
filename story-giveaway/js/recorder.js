function pickMimeType() {
  const types = [
    'video/webm;codecs=vp8',
    'video/webm;codecs=vp9',
    'video/webm',
    'video/mp4',
  ];
  for (const type of types) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(type)) {
      return type;
    }
  }
  return '';
}

/**
 * Record the current tab cropped to a single element (e.g. the phone iframe or #app).
 * Uses cursor: 'never' so the mouse is not in the video.
 * Must run from a user-gesture handler in the same window as `element`.
 */
export async function startAppRecording(element) {
  if (!element) throw new Error('Missing element to record');
  if (!navigator.mediaDevices?.getDisplayMedia) {
    throw new Error('Screen recording is not supported in this browser');
  }
  if (!globalThis.CropTarget?.fromElement) {
    throw new Error('Need Chrome/Edge 104+ for element recording');
  }

  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: {
      frameRate: 30,
      displaySurface: 'browser',
      cursor: 'never',
    },
    audio: false,
    preferCurrentTab: true,
    selfBrowserSurface: 'include',
    systemAudio: 'exclude',
    surfaceSwitching: 'exclude',
    monitorTypeSurfaces: 'exclude',
  });

  const [track] = stream.getVideoTracks();

  try {
    // Prefer never showing the cursor if the track supports it
    if (typeof track.applyConstraints === 'function') {
      try {
        await track.applyConstraints({ cursor: 'never' });
      } catch {
        /* optional */
      }
    }
    const cropTarget = await CropTarget.fromElement(element);
    await track.cropTo(cropTarget);
  } catch (err) {
    stream.getTracks().forEach((t) => t.stop());
    throw new Error(
      'Could not crop to the app screen. Share this tab in Chrome/Edge.'
    );
  }

  const mimeType = pickMimeType();
  const chunks = [];
  const recorder = new MediaRecorder(
    stream,
    mimeType
      ? { mimeType, videoBitsPerSecond: 8_000_000 }
      : { videoBitsPerSecond: 8_000_000 }
  );

  recorder.ondataavailable = (event) => {
    if (event.data?.size) chunks.push(event.data);
  };

  const stopped = new Promise((resolve) => {
    recorder.addEventListener('stop', () => resolve(), { once: true });
  });

  track.addEventListener('ended', () => {
    if (recorder.state !== 'inactive') recorder.stop();
  });

  recorder.start(250);
  // Brief settle so crop is active before the animation starts
  await new Promise((r) => setTimeout(r, 200));

  return { recorder, stream, chunks, stopped, mimeType };
}

export async function stopAndDownload(session, baseName = 'story-giveaway') {
  if (!session) return null;

  const { recorder, stream, chunks, stopped, mimeType } = session;

  if (recorder.state === 'recording' || recorder.state === 'paused') {
    try {
      recorder.requestData();
    } catch {
      /* ignore */
    }
    await new Promise((r) => setTimeout(r, 120));
    if (recorder.state !== 'inactive') recorder.stop();
  }

  await stopped;
  await new Promise((r) => setTimeout(r, 80));
  stream.getTracks().forEach((track) => track.stop());

  const type = mimeType || chunks[0]?.type || 'video/webm';
  const blob = new Blob(chunks, { type });
  if (!blob.size) throw new Error('Recording was empty');

  const ext = type.includes('mp4') ? 'mp4' : 'webm';
  const filename = `${baseName}-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.${ext}`;

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 8000);

  return { blob, filename };
}

export function abortRecording(session) {
  if (!session) return;
  try {
    if (session.recorder?.state !== 'inactive') session.recorder.stop();
  } catch {
    /* ignore */
  }
  session.stream?.getTracks?.().forEach((t) => t.stop());
}
