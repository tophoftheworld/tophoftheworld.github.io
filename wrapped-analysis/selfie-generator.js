// Firebase setup
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js";
import { getFirestore, collection, getDocs, doc, getDoc } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyA6ikBMsQACcUpn4Jff7PQFeWLN8wv18EE",
    authDomain: "matchanese-attendance.firebaseapp.com",
    projectId: "matchanese-attendance",
    storageBucket: "matchanese-attendance.firebasestorage.app",
    messagingSenderId: "339591618451",
    appId: "1:339591618451:web:23f9d95833ee5010bbd266",
    measurementId: "G-YEK4GML6SJ"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// Constants
const YEAR_START = new Date('2025-01-01');
const YEAR_END = new Date('2025-12-31');

// State
let employees = {};
let allSelfies = {}; // { employeeId: [selfie objects] }
let currentEmployeeId = null;

// DOM elements
const employeeSelect = document.getElementById('employeeSelect');
const selfieContainer = document.getElementById('selfieContainer');
const selfieInfo = document.getElementById('selfieInfo');
const tapHint = document.getElementById('tapHint');
const stats = document.getElementById('stats');
const downloadSection = document.getElementById('downloadSection');
const downloadVideoBtn = document.getElementById('downloadVideoBtn');
const downloadProgress = document.getElementById('downloadProgress');
const videoProgressFill = document.getElementById('videoProgressFill');
const progressText = document.querySelector('#downloadProgress .progress-text');
const errorMessage = document.getElementById('errorMessage');

// Load employees
async function loadEmployees() {
    try {
        const employeesRef = collection(db, 'employees');
        const snapshot = await getDocs(employeesRef);
        
        employees = {};
        snapshot.forEach(doc => {
            const data = doc.data();
            if (data.active !== false) { // Only active employees
                employees[doc.id] = {
                    id: doc.id,
                    name: data.name || 'Unknown',
                    ...data
                };
            }
        });
        
        // Populate dropdown
        employeeSelect.innerHTML = '<option value="">-- Select an employee --</option>';
        const sorted = Object.values(employees).sort((a, b) => a.name.localeCompare(b.name));
        sorted.forEach(emp => {
            const option = document.createElement('option');
            option.value = emp.id;
            option.textContent = emp.name;
            employeeSelect.appendChild(option);
        });
        
        console.log(`Loaded ${Object.keys(employees).length} employees`);
    } catch (error) {
        console.error("Error loading employees:", error);
        showError("Failed to load employees. Please refresh the page.");
    }
}

// Load selfie metadata (just dates and types, not images) for an employee
async function loadEmployeeSelfieMetadata(employeeId) {
    if (allSelfies[employeeId]) {
        return allSelfies[employeeId]; // Return cached
    }
    
    try {
        const selfieMetadata = [];
        
        // Attendance is stored in subcollection: attendance/{employeeId}/dates/{dateKey}
        const datesRef = collection(db, 'attendance', employeeId, 'dates');
        const snapshot = await getDocs(datesRef);
        
        snapshot.forEach(doc => {
            const data = doc.data();
            const dateKey = doc.id; // Format: YYYY-MM-DD
            const recordDate = new Date(dateKey);
            
            // Only include 2025 records
            if (recordDate >= YEAR_START && recordDate <= YEAR_END) {
                // Check for clock-in selfie
                if (data.clockIn?.selfie) {
                    selfieMetadata.push({
                        date: dateKey,
                        type: 'Clock In',
                        time: data.clockIn.time || 'N/A',
                        branch: data.clockIn.branch || 'N/A',
                        hasSelfie: true
                    });
                }
                
                // Check for clock-out selfie
                if (data.clockOut?.selfie) {
                    selfieMetadata.push({
                        date: dateKey,
                        type: 'Clock Out',
                        time: data.clockOut.time || 'N/A',
                        branch: data.clockOut.branch || data.clockIn?.branch || 'N/A',
                        hasSelfie: true
                    });
                }
            }
        });
        
        // Cache the metadata
        allSelfies[employeeId] = selfieMetadata;
        
        console.log(`Loaded ${selfieMetadata.length} selfie entries for ${employees[employeeId]?.name}`);
        return selfieMetadata;
    } catch (error) {
        console.error("Error loading selfie metadata:", error);
        showError("Failed to load selfie data. Please try again.");
        return [];
    }
}

// Get a random selfie by fetching just that one record
async function getRandomSelfie(employeeId, metadata) {
    if (!metadata || metadata.length === 0) {
        return null;
    }
    
    // Pick a random entry
    const randomIndex = Math.floor(Math.random() * metadata.length);
    const selected = metadata[randomIndex];
    
    try {
        // Fetch just this one date's data to get the actual selfie URL
        const dateRef = doc(db, 'attendance', employeeId, 'dates', selected.date);
        const dateSnap = await getDoc(dateRef);
        
        if (!dateSnap.exists()) {
            return null;
        }
        
        const data = dateSnap.data();
        const selfieUrl = selected.type === 'Clock In' 
            ? data.clockIn?.selfie 
            : data.clockOut?.selfie;
        
        if (!selfieUrl) {
            return null;
        }
        
        return {
            url: selfieUrl,
            date: selected.date,
            type: selected.type,
            time: selected.time,
            branch: selected.branch
        };
    } catch (error) {
        console.error("Error fetching selfie:", error);
        return null;
    }
}

// Show random selfie
async function showRandomSelfie(employeeId, metadata) {
    if (!metadata || metadata.length === 0) {
        selfieContainer.innerHTML = '<div class="selfie-placeholder">No selfies found for this employee</div>';
        selfieInfo.style.display = 'none';
        tapHint.style.display = 'none';
        return;
    }
    
    // Show loading state
    selfieContainer.classList.add('loading');
    selfieContainer.innerHTML = '<div class="loading-spinner"></div>';
    
    // Get random selfie (fetches just one image)
    const selfie = await getRandomSelfie(employeeId, metadata);
    
    if (!selfie) {
        selfieContainer.classList.remove('loading');
        selfieContainer.innerHTML = '<div class="selfie-placeholder">Failed to load selfie</div>';
        selfieInfo.style.display = 'none';
        tapHint.style.display = 'none';
        return;
    }
    
    // Create image
    const img = document.createElement('img');
    img.className = 'selfie-image';
    img.src = selfie.url;
    img.alt = 'Selfie';
    
    // Handle image load
    img.onload = () => {
        selfieContainer.classList.remove('loading');
        selfieContainer.innerHTML = '';
        selfieContainer.appendChild(img);
        
        // Show info
        const date = new Date(selfie.date);
        const dateStr = date.toLocaleDateString('en-US', { 
            month: 'short', 
            day: 'numeric', 
            year: 'numeric' 
        });
        
        selfieInfo.innerHTML = `
            <strong>${selfie.type}</strong> on ${dateStr}<br>
            Time: ${selfie.time} | Branch: ${selfie.branch}
        `;
        selfieInfo.style.display = 'block';
        tapHint.style.display = 'block';
    };
    
    // Handle image error
    img.onerror = () => {
        selfieContainer.classList.remove('loading');
        selfieContainer.innerHTML = '<div class="selfie-placeholder">Failed to load image</div>';
        selfieInfo.style.display = 'none';
    };
}

// Show error message
function showError(message) {
    errorMessage.textContent = message;
    errorMessage.style.display = 'block';
    setTimeout(() => {
        errorMessage.style.display = 'none';
    }, 5000);
}

// Update stats display
function updateStats(metadata) {
    if (!metadata || metadata.length === 0) {
        stats.style.display = 'none';
        return;
    }
    
    const clockInCount = metadata.filter(s => s.type === 'Clock In').length;
    const clockOutCount = metadata.filter(s => s.type === 'Clock Out').length;
    
    stats.innerHTML = `
        Total selfies: <strong>${metadata.length}</strong> 
        (${clockInCount} in, ${clockOutCount} out)
    `;
    stats.style.display = 'block';
}

// Handle employee selection
async function handleEmployeeChange() {
    const employeeId = employeeSelect.value;
    
    if (!employeeId) {
        selfieContainer.style.display = 'none';
        selfieInfo.style.display = 'none';
        tapHint.style.display = 'none';
        stats.style.display = 'none';
        return;
    }
    
    currentEmployeeId = employeeId;
    selfieContainer.style.display = 'flex';
    
    // Load selfie metadata for this employee (fast - just dates/types, not images)
    const metadata = await loadEmployeeSelfieMetadata(employeeId);
    updateStats(metadata);
    
    // Show download section if there are selfies
    if (metadata && metadata.length > 0) {
        downloadSection.style.display = 'block';
    } else {
        downloadSection.style.display = 'none';
    }
    
    // Show random selfie (loads just one image)
    await showRandomSelfie(employeeId, metadata);
}

// Handle selfie container click
selfieContainer.addEventListener('click', async () => {
    if (currentEmployeeId && allSelfies[currentEmployeeId]) {
        await showRandomSelfie(currentEmployeeId, allSelfies[currentEmployeeId]);
    }
});

// Load all selfies for video creation (ordered by date)
async function loadAllSelfiesForVideo(employeeId, metadata) {
    const selfies = [];
    
    // Sort metadata by date
    const sortedMetadata = [...metadata].sort((a, b) => {
        const dateA = new Date(a.date);
        const dateB = new Date(b.date);
        if (dateA.getTime() !== dateB.getTime()) {
            return dateA - dateB;
        }
        // If same date, Clock In comes before Clock Out
        return a.type === 'Clock In' ? -1 : 1;
    });
    
    // Load each selfie URL
    for (const entry of sortedMetadata) {
        try {
            const dateRef = doc(db, 'attendance', employeeId, 'dates', entry.date);
            const dateSnap = await getDoc(dateRef);
            
            if (dateSnap.exists()) {
                const data = dateSnap.data();
                const selfieUrl = entry.type === 'Clock In' 
                    ? data.clockIn?.selfie 
                    : data.clockOut?.selfie;
                
                if (selfieUrl) {
                    selfies.push({
                        url: selfieUrl,
                        date: entry.date,
                        type: entry.type,
                        time: entry.time,
                        branch: entry.branch
                    });
                }
            }
        } catch (error) {
            console.error(`Error loading selfie for ${entry.date}:`, error);
        }
    }
    
    return selfies;
}

// Create timelapse video from selfies
async function createTimelapseVideo(employeeId, metadata) {
    downloadVideoBtn.disabled = true;
    downloadProgress.style.display = 'block';
    videoProgressFill.style.width = '0%';
    
    // Try different codecs in order of preference (declare outside try for scope)
    let mimeType = 'video/webm;codecs=vp9';
    if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = 'video/webm;codecs=vp8';
        if (!MediaRecorder.isTypeSupported(mimeType)) {
            mimeType = 'video/webm';
            if (!MediaRecorder.isTypeSupported(mimeType)) {
                mimeType = 'video/mp4';
            }
        }
    }
    
    try {
        // Load all selfies
        videoProgressFill.style.width = '10%';
        if (progressText) {
            progressText.textContent = `Loading selfies for ${employees[employeeId]?.name || 'employee'}...`;
        }
        const selfies = await loadAllSelfiesForVideo(employeeId, metadata);
        
        if (selfies.length === 0) {
            showError("No selfies found to create video");
            downloadVideoBtn.disabled = false;
            downloadProgress.style.display = 'none';
            return;
        }
        
        if (progressText) {
            progressText.textContent = `Found ${selfies.length} selfies. Starting video creation...`;
        }
        
        // Create canvas for video (portrait format)
        const canvas = document.createElement('canvas');
        canvas.width = 1080; // Portrait width
        canvas.height = 1920; // Portrait height
        const ctx = canvas.getContext('2d');
        
        // Set up MediaRecorder
        const stream = canvas.captureStream(30); // 30 fps
        const mediaRecorder = new MediaRecorder(stream, { mimeType });
        
        const chunks = [];
        mediaRecorder.ondataavailable = (e) => {
            if (e.data.size > 0) {
                chunks.push(e.data);
            }
        };
        
        mediaRecorder.onstop = () => {
            const blob = new Blob(chunks, { type: mimeType });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            const extension = mimeType.includes('mp4') ? 'mp4' : 'webm';
            link.download = `${employees[employeeId]?.name || 'employee'}-timelapse-2025.${extension}`;
            link.click();
            URL.revokeObjectURL(url);
            
            downloadVideoBtn.disabled = false;
            downloadProgress.style.display = 'none';
            videoProgressFill.style.width = '0%';
        };
        
        // Preload all images first (so video timing is independent of network speed)
        videoProgressFill.style.width = '10%';
        const loadedImages = [];
        const totalFrames = selfies.length;
        
        console.log(`Preloading ${totalFrames} images...`);
        for (let i = 0; i < selfies.length; i++) {
            const selfie = selfies[i];
            
            // Load image
            const img = await new Promise((resolve, reject) => {
                const image = new Image();
                image.crossOrigin = 'anonymous';
                image.onload = () => resolve(image);
                image.onerror = () => {
                    console.warn(`Failed to load image ${i + 1}/${totalFrames}`);
                    // Create a blank image as fallback
                    const blank = new Image();
                    blank.width = canvas.width;
                    blank.height = canvas.height;
                    resolve(blank);
                };
                image.src = selfie.url;
            });
            
            loadedImages.push(img);
            
            // Update progress (10% to 80% for loading)
            const progress = 10 + ((i + 1) / totalFrames) * 70;
            videoProgressFill.style.width = `${progress}%`;
        }
        
        console.log(`All images preloaded. Starting video recording...`);
        
        // Start recording after all images are loaded
        mediaRecorder.start();
        
        // Wait for MediaRecorder to fully initialize
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Display each preloaded selfie for a short duration
        const FRAME_DURATION = 100; // 100ms per selfie (0.1 seconds)
        
        // Helper function to wait for exact duration
        const waitForDuration = (ms) => {
            return new Promise(resolve => {
                const startTime = performance.now();
                const checkTime = () => {
                    const elapsed = performance.now() - startTime;
                    if (elapsed >= ms) {
                        resolve();
                    } else {
                        requestAnimationFrame(checkTime);
                    }
                };
                requestAnimationFrame(checkTime);
            });
        };
        
        // Now create video with consistent timing (independent of network speed)
        for (let i = 0; i < loadedImages.length; i++) {
            const img = loadedImages[i];
            const frameStartTime = performance.now();
            
            // Clear canvas first to avoid artifacts
            ctx.fillStyle = '#000';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            
            // Draw image on canvas (cropped to fill, centered)
            // Calculate scale to cover entire canvas (crop excess)
            const scale = Math.max(canvas.width / img.width, canvas.height / img.height);
            
            // Calculate dimensions after scaling
            const scaledWidth = img.width * scale;
            const scaledHeight = img.height * scale;
            
            // Calculate position to center (negative values will crop)
            const x = (canvas.width - scaledWidth) / 2;
            const y = (canvas.height - scaledHeight) / 2;
            
            // Draw image cropped to fill canvas
            ctx.drawImage(img, x, y, scaledWidth, scaledHeight);
            
            // Ensure frame is rendered
            await new Promise(resolve => requestAnimationFrame(resolve));
            
            // Update progress (80% to 95% for video generation)
            const progress = 80 + ((i + 1) / totalFrames) * 15;
            videoProgressFill.style.width = `${progress}%`;
            
            // Update status text
            if (progressText) {
                progressText.textContent = `Creating video: Frame ${i + 1}/${totalFrames} (${Math.round(progress)}%)...`;
            }
            
            // Calculate how long we've spent so far (drawing + rendering)
            const elapsed = performance.now() - frameStartTime;
            const remainingTime = Math.max(0, FRAME_DURATION - elapsed);
            
            // Wait for remaining time to ensure exactly FRAME_DURATION per image
            if (remainingTime > 0) {
                await waitForDuration(remainingTime);
            }
        }
        
        // Wait for final duration before stopping
        if (progressText) {
            progressText.textContent = `Finalizing video...`;
        }
        await waitForDuration(FRAME_DURATION);
        mediaRecorder.stop();
        videoProgressFill.style.width = '100%';
        if (progressText) {
            progressText.textContent = `Video complete!`;
        }
        
    } catch (error) {
        console.error("Error creating video:", error);
        showError("Failed to create video: " + error.message);
        downloadVideoBtn.disabled = false;
        downloadProgress.style.display = 'none';
        videoProgressFill.style.width = '0%';
    }
}

// Load metadata from all employees, then randomly select and fetch only needed selfies
async function loadRandomSelfiesForTimelapse(totalNeeded) {
    const RANDOM_TIMELAPSE_DURATION = 10; // 10 seconds
    const FRAME_DURATION = 0.1; // 0.1 seconds per frame
    const TOTAL_FRAMES = Math.floor(RANDOM_TIMELAPSE_DURATION / FRAME_DURATION); // 100 frames
    
    const employeeIds = Object.keys(employees);
    const totalEmployees = employeeIds.length;
    const allMetadata = []; // Store metadata with employeeId reference
    
    console.log(`Loading metadata from ${totalEmployees} employees...`);
    if (progressText) {
        progressText.textContent = `Loading metadata from ${totalEmployees} employees...`;
    }
    
    // Step 1: Get metadata (dates with selfies) from all employees - this is fast
    for (let i = 0; i < employeeIds.length; i++) {
        const employeeId = employeeIds[i];
        const employeeName = employees[employeeId]?.name || 'Unknown';
        
        try {
            if (progressText) {
                progressText.textContent = `Getting metadata from ${employeeName} (${i + 1}/${totalEmployees} employees)...`;
            }
            
            const metadata = await loadEmployeeSelfieMetadata(employeeId);
            if (metadata && metadata.length > 0) {
                // Add employeeId to each metadata entry
                metadata.forEach(entry => {
                    allMetadata.push({
                        ...entry,
                        employeeId: employeeId
                    });
                });
            }
        } catch (error) {
            console.error(`Error loading metadata for ${employeeName}:`, error);
        }
        
        // Update progress bar (0% to 5% for loading metadata)
        const progress = (i + 1) / totalEmployees * 5;
        videoProgressFill.style.width = `${progress}%`;
    }
    
    console.log(`Found ${allMetadata.length} total selfie entries from ${totalEmployees} employees`);
    if (progressText) {
        progressText.textContent = `Found ${allMetadata.length} selfie entries. Selecting ${totalNeeded} random ones...`;
    }
    
    // Step 2: Randomly select only the number we need
    const selectedMetadata = [];
    if (allMetadata.length <= totalNeeded) {
        // Use all, just shuffle
        selectedMetadata.push(...allMetadata);
        for (let i = selectedMetadata.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [selectedMetadata[i], selectedMetadata[j]] = [selectedMetadata[j], selectedMetadata[i]];
        }
    } else {
        // Randomly select totalNeeded entries
        const shuffled = [...allMetadata];
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        selectedMetadata.push(...shuffled.slice(0, totalNeeded));
    }
    
    console.log(`Selected ${selectedMetadata.length} random entries. Now fetching selfie URLs...`);
    if (progressText) {
        progressText.textContent = `Fetching ${selectedMetadata.length} selfie URLs...`;
    }
    
    // Step 3: Fetch only the selected selfie URLs (much faster!)
    const selectedSelfies = [];
    for (let i = 0; i < selectedMetadata.length; i++) {
        const entry = selectedMetadata[i];
        
        if (progressText && (i + 1) % 10 === 0) {
            progressText.textContent = `Fetching selfie URLs (${i + 1}/${selectedMetadata.length})...`;
        }
        
        try {
            const dateRef = doc(db, 'attendance', entry.employeeId, 'dates', entry.date);
            const dateSnap = await getDoc(dateRef);
            
            if (dateSnap.exists()) {
                const data = dateSnap.data();
                const selfieUrl = entry.type === 'Clock In' 
                    ? data.clockIn?.selfie 
                    : data.clockOut?.selfie;
                
                if (selfieUrl) {
                    selectedSelfies.push({
                        url: selfieUrl,
                        date: entry.date,
                        type: entry.type,
                        time: entry.time,
                        branch: entry.branch
                    });
                }
            }
        } catch (error) {
            console.error(`Error loading selfie for ${entry.date}:`, error);
        }
        
        // Update progress bar (5% to 10% for fetching URLs)
        const progress = 5 + ((i + 1) / selectedMetadata.length) * 5;
        videoProgressFill.style.width = `${progress}%`;
    }
    
    console.log(`Fetched ${selectedSelfies.length} selfie URLs`);
    if (progressText) {
        progressText.textContent = `Ready! ${selectedSelfies.length} selfies selected for timelapse`;
    }
    
    return selectedSelfies;
}

// Create random timelapse from all employees
async function createRandomTimelapse() {
    const RANDOM_TIMELAPSE_DURATION = 10; // 10 seconds
    const FRAME_DURATION = 0.1; // 0.1 seconds per frame
    const TOTAL_FRAMES = Math.floor(RANDOM_TIMELAPSE_DURATION / FRAME_DURATION); // 100 frames
    
    downloadVideoBtn.disabled = true;
    downloadProgress.style.display = 'block';
    videoProgressFill.style.width = '0%';
    
    try {
        // Load metadata, randomly select, then fetch only needed selfies (much faster!)
        const selectedSelfies = await loadRandomSelfiesForTimelapse(TOTAL_FRAMES);
        
        if (selectedSelfies.length === 0) {
            showError("No selfies found from any employees");
            downloadVideoBtn.disabled = false;
            downloadProgress.style.display = 'none';
            return;
        }
        
        console.log(`Selected ${selectedSelfies.length} random selfies for ${RANDOM_TIMELAPSE_DURATION}s timelapse`);
        
        // Use the same video creation logic but with random selfies
        await createTimelapseVideoFromSelfies(selectedSelfies, 'random-timelapse-2025');
        
    } catch (error) {
        console.error("Error creating random timelapse:", error);
        showError("Failed to create random timelapse: " + error.message);
        downloadVideoBtn.disabled = false;
        downloadProgress.style.display = 'none';
        videoProgressFill.style.width = '0%';
    }
}

// Modified version of createTimelapseVideo that accepts selfies array directly
async function createTimelapseVideoFromSelfies(selfies, filename) {
    // Try different codecs in order of preference
    let mimeType = 'video/webm;codecs=vp9';
    if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = 'video/webm;codecs=vp8';
        if (!MediaRecorder.isTypeSupported(mimeType)) {
            mimeType = 'video/webm';
            if (!MediaRecorder.isTypeSupported(mimeType)) {
                mimeType = 'video/mp4';
            }
        }
    }
    
    try {
        // Preload all images first
        videoProgressFill.style.width = '10%';
        if (progressText) {
            progressText.textContent = `Preloading images (0/${selfies.length})...`;
        }
        const loadedImages = [];
        const totalFrames = selfies.length;
        
        console.log(`Preloading ${totalFrames} images...`);
        for (let i = 0; i < selfies.length; i++) {
            const selfie = selfies[i];
            
            // Update status text
            if (progressText) {
                progressText.textContent = `Preloading images (${i + 1}/${totalFrames})...`;
            }
            
            // Load image
            const img = await new Promise((resolve, reject) => {
                const image = new Image();
                image.crossOrigin = 'anonymous';
                image.onload = () => resolve(image);
                image.onerror = () => {
                    console.warn(`Failed to load image ${i + 1}/${totalFrames}`);
                    // Create a blank image as fallback
                    const blank = new Image();
                    blank.width = 1080;
                    blank.height = 1920;
                    resolve(blank);
                };
                image.src = selfie.url;
            });
            
            loadedImages.push(img);
            
            // Update progress (10% to 80% for loading)
            const progress = 10 + ((i + 1) / totalFrames) * 70;
            videoProgressFill.style.width = `${progress}%`;
        }
        
        console.log(`All images preloaded. Starting video recording...`);
        if (progressText) {
            progressText.textContent = `All images loaded. Starting video recording...`;
        }
        
        // Create canvas for video (portrait format)
        const canvas = document.createElement('canvas');
        canvas.width = 1080;
        canvas.height = 1920;
        const ctx = canvas.getContext('2d');
        
        // Set up MediaRecorder
        const stream = canvas.captureStream(30); // 30 fps
        const mediaRecorder = new MediaRecorder(stream, { mimeType });
        
        const chunks = [];
        mediaRecorder.ondataavailable = (e) => {
            if (e.data.size > 0) {
                chunks.push(e.data);
            }
        };
        
        mediaRecorder.onstop = () => {
            const blob = new Blob(chunks, { type: mimeType });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            const extension = mimeType.includes('mp4') ? 'mp4' : 'webm';
            link.download = `${filename}.${extension}`;
            link.click();
            URL.revokeObjectURL(url);
            
            downloadVideoBtn.disabled = false;
            downloadProgress.style.display = 'none';
            videoProgressFill.style.width = '0%';
        };
        
        // Start recording after all images are loaded
        mediaRecorder.start();
        
        // Wait for MediaRecorder to fully initialize
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Display each preloaded selfie for a short duration
        const FRAME_DURATION = 100; // 100ms per selfie (0.1 seconds)
        
        // Helper function to wait for exact duration
        const waitForDuration = (ms) => {
            return new Promise(resolve => {
                const startTime = performance.now();
                const checkTime = () => {
                    const elapsed = performance.now() - startTime;
                    if (elapsed >= ms) {
                        resolve();
                    } else {
                        requestAnimationFrame(checkTime);
                    }
                };
                requestAnimationFrame(checkTime);
            });
        };
        
        // Now create video with consistent timing
        for (let i = 0; i < loadedImages.length; i++) {
            const img = loadedImages[i];
            const frameStartTime = performance.now();
            
            // Clear canvas first to avoid artifacts
            ctx.fillStyle = '#000';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            
            // Draw image on canvas (cropped to fill, centered)
            const scale = Math.max(canvas.width / img.width, canvas.height / img.height);
            const scaledWidth = img.width * scale;
            const scaledHeight = img.height * scale;
            const x = (canvas.width - scaledWidth) / 2;
            const y = (canvas.height - scaledHeight) / 2;
            
            ctx.drawImage(img, x, y, scaledWidth, scaledHeight);
            
            // Ensure frame is rendered
            await new Promise(resolve => requestAnimationFrame(resolve));
            
            // Update progress (80% to 95% for video generation)
            const progress = 80 + ((i + 1) / totalFrames) * 15;
            videoProgressFill.style.width = `${progress}%`;
            
            // Update status text
            if (progressText) {
                progressText.textContent = `Creating video: Frame ${i + 1}/${totalFrames} (${Math.round(progress)}%)...`;
            }
            
            // Calculate how long we've spent so far
            const elapsed = performance.now() - frameStartTime;
            const remainingTime = Math.max(0, FRAME_DURATION - elapsed);
            
            // Wait for remaining time
            if (remainingTime > 0) {
                await waitForDuration(remainingTime);
            }
        }
        
        // Wait for final duration before stopping
        if (progressText) {
            progressText.textContent = `Finalizing video...`;
        }
        await waitForDuration(FRAME_DURATION);
        mediaRecorder.stop();
        videoProgressFill.style.width = '100%';
        if (progressText) {
            progressText.textContent = `Video complete!`;
        }
        
    } catch (error) {
        console.error("Error creating video:", error);
        showError("Failed to create video: " + error.message);
        downloadVideoBtn.disabled = false;
        downloadProgress.style.display = 'none';
        videoProgressFill.style.width = '0%';
    }
}

// Initialize
const randomTimelapseBtn = document.getElementById('randomTimelapseBtn');
randomTimelapseBtn.addEventListener('click', createRandomTimelapse);

employeeSelect.addEventListener('change', handleEmployeeChange);
downloadVideoBtn.addEventListener('click', async () => {
    if (currentEmployeeId && allSelfies[currentEmployeeId]) {
        await createTimelapseVideo(currentEmployeeId, allSelfies[currentEmployeeId]);
    }
});

// Load employees on page load
loadEmployees();

