const esc = (s) => String(s ?? '').replace(/[&<>'"]/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
}[c]));

function dataUrlToBlobUrl(dataUrl) {
  try {
    if (!String(dataUrl || '').startsWith('data:')) return dataUrl;
    const [header, payload] = dataUrl.split(',', 2);
    const mime = (header.match(/^data:([^;,]+)/) || [,'application/octet-stream'])[1];
    const isBase64 = /;base64/i.test(header);
    const binary = isBase64 ? atob(payload) : decodeURIComponent(payload);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return URL.createObjectURL(new Blob([bytes], { type: mime }));
  } catch (err) {
    console.error('원본 이미지 변환 실패', err);
    return dataUrl;
  }
}

function createGalleryViewer() {
  let viewer = document.getElementById('galleryViewer');
  if (viewer) return viewer;

  viewer = document.createElement('div');
  viewer.id = 'galleryViewer';
  viewer.className = 'gallery-viewer';
  viewer.hidden = true;
  viewer.innerHTML = `
    <div class="gallery-viewer-backdrop" data-viewer-close></div>
    <section class="gallery-viewer-panel" role="dialog" aria-modal="true" aria-label="완성 작품 크게 보기">
      <div class="gallery-viewer-topbar">
        <div>
          <div id="galleryViewerType" class="gallery-viewer-type">완성 작품</div>
          <strong id="galleryViewerTitle">마음을 담은 글씨</strong>
        </div>
        <button type="button" class="gallery-viewer-close" data-viewer-close aria-label="닫기">×</button>
      </div>
      <div class="gallery-viewer-actions">
        <button type="button" data-zoom="out">− 축소</button>
        <button type="button" data-zoom="reset">화면 맞춤</button>
        <button type="button" data-zoom="in">＋ 확대</button>
        <button type="button" id="galleryOpenOriginal">원본 새 창</button>
      </div>
      <div id="galleryViewerStage" class="gallery-viewer-stage">
        <img id="galleryViewerImage" alt="글결 완성 작품">
      </div>
      <div class="gallery-viewer-note">이미지를 클릭해도 확대/화면 맞춤이 전환됩니다.</div>
    </section>`;
  document.body.appendChild(viewer);

  const image = viewer.querySelector('#galleryViewerImage');
  const stage = viewer.querySelector('#galleryViewerStage');
  const type = viewer.querySelector('#galleryViewerType');
  const title = viewer.querySelector('#galleryViewerTitle');
  const originalButton = viewer.querySelector('#galleryOpenOriginal');
  let currentSrc = '';
  let zoom = 1;

  const renderZoom = () => {
    image.style.transform = `scale(${zoom})`;
    image.style.transformOrigin = 'center center';
    image.classList.toggle('is-zoomed', zoom > 1.01);
  };

  const reset = () => {
    zoom = 1;
    renderZoom();
    stage.scrollTop = 0;
    stage.scrollLeft = 0;
  };

  const close = () => {
    viewer.hidden = true;
    document.body.classList.remove('gallery-viewer-open');
    reset();
  };

  viewer.querySelectorAll('[data-viewer-close]').forEach((el) => el.addEventListener('click', close));
  viewer.querySelector('[data-zoom="in"]').addEventListener('click', () => {
    zoom = Math.min(4, +(zoom + 0.5).toFixed(2));
    renderZoom();
  });
  viewer.querySelector('[data-zoom="out"]').addEventListener('click', () => {
    zoom = Math.max(0.5, +(zoom - 0.5).toFixed(2));
    renderZoom();
  });
  viewer.querySelector('[data-zoom="reset"]').addEventListener('click', reset);
  image.addEventListener('click', () => {
    zoom = zoom > 1.01 ? 1 : 2;
    renderZoom();
  });
  originalButton.addEventListener('click', () => {
    if (!currentSrc) return;
    const openUrl = dataUrlToBlobUrl(currentSrc);
    const newWindow = window.open(openUrl, '_blank', 'noopener');
    if (!newWindow) alert('새 창이 차단되었습니다. 브라우저의 팝업 허용 후 다시 눌러 주세요.');
    if (openUrl && openUrl.startsWith('blob:')) setTimeout(() => URL.revokeObjectURL(openUrl), 60000);
  });
  document.addEventListener('keydown', (e) => {
    if (viewer.hidden) return;
    if (e.key === 'Escape') close();
  });

  viewer.openWork = ({ src, workType, sentence }) => {
    currentSrc = src || '';
    image.src = currentSrc;
    image.alt = workType || '글결 완성 작품';
    type.textContent = workType || '완성 작품';
    title.textContent = sentence || '마음을 담은 글씨';
    viewer.hidden = false;
    document.body.classList.add('gallery-viewer-open');
    reset();
  };
  return viewer;
}

document.addEventListener('DOMContentLoaded', async () => {
  const root = document.getElementById('galleryList');
  const viewer = createGalleryViewer();
  if (!root) return;

  try {
    const response = await fetch('/api/gallery', { cache: 'no-store' });
    if (!response.ok) throw new Error(`gallery api ${response.status}`);
    const rows = await response.json();

    if (!Array.isArray(rows) || rows.length === 0) {
      root.innerHTML = '<div class="empty-gallery"><strong>공개된 작품을 준비하고 있습니다.</strong><p>고객의 동의를 받은 작품만 이곳에 소개됩니다.</p></div>';
      return;
    }

    root.innerHTML = rows.map((o, i) => `
      <article class="gallery-card" data-gallery-index="${i}">
        <button type="button" class="gallery-image-button" aria-label="${esc(o.workType || '완성 작품')} 크게 보기">
          <img src="${o.completedImage}" alt="${esc(o.workType || '글결 완성 작품')}">
          <span class="gallery-zoom-hint">🔍 크게 보기</span>
        </button>
        <div class="gallery-card-info">
          <span>${esc(o.workType || '완성 작품')}</span>
          <h2>${esc(o.sentence || '마음을 담은 글씨')}</h2>
          <p>${esc(o.completedDate || '')}</p>
          <button type="button" class="gallery-open-button">작품 크게 보기</button>
        </div>
      </article>`).join('');

    root.querySelectorAll('.gallery-card').forEach((card) => {
      const row = rows[Number(card.dataset.galleryIndex)];
      const open = () => {
        if (!row?.completedImage) return;
        viewer.openWork({ src: row.completedImage, workType: row.workType, sentence: row.sentence });
      };
      card.querySelector('.gallery-image-button')?.addEventListener('click', open);
      card.querySelector('.gallery-open-button')?.addEventListener('click', open);
    });
  } catch (error) {
    console.error(error);
    root.innerHTML = '<div class="empty-gallery"><strong>작품을 불러오지 못했습니다.</strong><p>잠시 후 다시 시도해 주세요.</p></div>';
  }
});
