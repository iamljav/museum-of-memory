/**
 * app.js
 * The Museum of Memory — UI orchestration
 */

(function () {
  const uploadZone     = document.getElementById('upload-zone');
  const fileInput      = document.getElementById('file-input');
  const uploadSection  = document.getElementById('upload-section');
  const studioSection  = document.getElementById('studio-section');
  const canvas         = document.getElementById('result-canvas');
  const ctx            = canvas.getContext('2d');
  const processingOverlay = document.getElementById('processing-overlay');
  const decaySlider    = document.getElementById('decay-slider');
  const decayVal       = document.getElementById('decay-val');
  const sepiaSlider    = document.getElementById('sepia-slider');
  const sepiaVal       = document.getElementById('sepia-val');
  const seedDisplay    = document.getElementById('seed-display');
  const dimensionsDisplay = document.getElementById('dimensions-display');
  const modeBtns       = document.querySelectorAll('.mode-btn');
  const randomizeBtn   = document.getElementById('randomize-btn');
  const uploadAnotherBtn = document.getElementById('upload-another-btn');
  const downloadBtn    = document.getElementById('download-btn');

  let currentImage  = null;
  let currentSeed   = 0;
  let currentMode   = 'organic';
  let renderPending = false;
  let renderTimer   = null;

  // --- Upload zone ---
  uploadZone.addEventListener('dragover', e => {
    e.preventDefault();
    uploadZone.classList.add('dragover');
  });

  uploadZone.addEventListener('dragleave', () => {
    uploadZone.classList.remove('dragover');
  });

  uploadZone.addEventListener('drop', e => {
    e.preventDefault();
    uploadZone.classList.remove('dragover');
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) loadFile(file);
  });

  fileInput.addEventListener('change', e => {
    if (e.target.files[0]) loadFile(e.target.files[0]);
  });

  uploadAnotherBtn.addEventListener('click', () => {
    studioSection.style.display = 'none';
    uploadSection.style.display = 'flex';
    currentImage = null;
    fileInput.value = '';
  });

  // --- Controls ---
  decaySlider.addEventListener('input', () => {
    decayVal.textContent = decaySlider.value + '%';
    scheduleRender(200);
  });

  sepiaSlider.addEventListener('input', () => {
    sepiaVal.textContent = sepiaSlider.value + '%';
    scheduleRender(200);
  });

  modeBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      modeBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentMode = btn.dataset.mode;
      scheduleRender(0);
    });
  });

  randomizeBtn.addEventListener('click', () => {
    currentSeed = Math.floor(Math.random() * 0xffffffff);
    scheduleRender(0);
  });

  downloadBtn.addEventListener('click', () => {
    const link = document.createElement('a');
    const seedHex = currentSeed.toString(16).padStart(8, '0');
    link.download = `memory-${seedHex}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  });

  // --- File loading ---
  function loadFile(file) {
    const reader = new FileReader();
    reader.onload = ev => {
      const img = new Image();
      img.onload = () => {
        currentImage = img;
        currentSeed = Math.floor(Math.random() * 0xffffffff);
        uploadSection.style.display = 'none';
        studioSection.style.display = 'grid';
        render();
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  }

  // --- Rendering ---
  function scheduleRender(delay) {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(render, delay);
  }

  function render() {
    if (!currentImage) return;

    // Show processing state
    processingOverlay.classList.add('active');

    // Defer to next frame so overlay paint happens first
    requestAnimationFrame(() => {
      setTimeout(() => {
        const MAX_W = 1400;
        let sw = currentImage.naturalWidth;
        let sh = currentImage.naturalHeight;

        if (sw > MAX_W) {
          sh = Math.round(sh * MAX_W / sw);
          sw = MAX_W;
        }

        canvas.width  = sw;
        canvas.height = sh;

        ctx.drawImage(currentImage, 0, 0, sw, sh);
        let imgData = ctx.getImageData(0, 0, sw, sh);

        imgData = window.applyCorruption(imgData, sw, sh, {
          decay: parseInt(decaySlider.value),
          sepia: parseInt(sepiaSlider.value),
          mode:  currentMode,
          seed:  currentSeed
        });

        ctx.putImageData(imgData, 0, 0);

        // Update metadata
        const seedHex = currentSeed.toString(16).padStart(8, '0');
        seedDisplay.textContent = `seed · ${seedHex}`;
        dimensionsDisplay.textContent = `${sw} × ${sh}`;

        processingOverlay.classList.remove('active');
      }, 30);
    });
  }

})();
