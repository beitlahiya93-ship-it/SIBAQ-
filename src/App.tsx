import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Check,
  Crop,
  Download,
  ImagePlus,
  Minus,
  Plus,
  RotateCcw,
  User,
  X,
} from 'lucide-react';

/* ============================================================================
 * POSTER TEMPLATE CONFIGURATION
 * Adjust these constants to match any poster template dimensions and layout.
 * All coordinates are in the original poster's native pixel resolution.
 * ========================================================================== */

// Replace this URL with your own poster template image URL or local asset path.
const POSTER_IMAGE_URL = '/assets/aistudio/1000135822__1__ee376e19.jpg';

// Rectangular photo slot coordinates (measured at native 1792 x 2400 resolution)
const PHOTO_BOX = {
  x: 1095,
  y: 1311,
  width: 302,
  height: 357,
  borderRadius: 43,
} as const;

// Name text placement and typography (centered directly below PHOTO_BOX)
// First Name always renders on line 1, Last Name always renders on line 2.
const NAME_STYLE = {
  x: PHOTO_BOX.x + PHOTO_BOX.width / 2, // 1246 — horizontal center of photo box
  y: 1682, // Top Y position directly below the photo box
  maxWidth: 340, // Maximum text width before auto-scaling font size down
  fontFamily: '"Plus Jakarta Sans", system-ui, -apple-system, sans-serif',
  fontWeight: '700',
  fontSize: 56,
  minFontSize: 20,
  lineHeight: 1.16,
  color: '#FFFFFF',
  textAlign: 'center' as CanvasTextAlign,
  shadowColor: 'rgba(0, 0, 0, 0.28)',
  shadowBlur: 6,
  shadowOffsetY: 2,
} as const;

const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MIN_ZOOM = 1;
const MAX_ZOOM = 3;

interface PhotoCrop {
  zoom: number;
  panX: number; // Offset in PHOTO_BOX coordinates (relative to center)
  panY: number; // Offset in PHOTO_BOX coordinates (relative to center)
}

const DEFAULT_CROP: PhotoCrop = {
  zoom: 1,
  panX: 0,
  panY: 0,
};

function drawRoundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(x, y, width, height, r);
  } else {
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + width - r, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + r);
    ctx.lineTo(x + width, y + height - r);
    ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
    ctx.lineTo(x + r, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }
}

function computeCoverPlacement(
  imgWidth: number,
  imgHeight: number,
  boxWidth: number,
  boxHeight: number,
  crop: PhotoCrop,
) {
  const baseScale = Math.max(boxWidth / imgWidth, boxHeight / imgHeight);
  const zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, crop.zoom));
  const totalScale = baseScale * zoom;

  const drawWidth = imgWidth * totalScale;
  const drawHeight = imgHeight * totalScale;

  const maxPanX = Math.max(0, (drawWidth - boxWidth) / 2);
  const maxPanY = Math.max(0, (drawHeight - boxHeight) / 2);

  const clampedPanX = Math.max(-maxPanX, Math.min(maxPanX, crop.panX));
  const clampedPanY = Math.max(-maxPanY, Math.min(maxPanY, crop.panY));

  const drawX = (boxWidth - drawWidth) / 2 + clampedPanX;
  const drawY = (boxHeight - drawHeight) / 2 + clampedPanY;

  return {
    drawX,
    drawY,
    drawWidth,
    drawHeight,
    clampedPanX,
    clampedPanY,
    maxPanX,
    maxPanY,
  };
}

function drawFirstAndLastName(
  ctx: CanvasRenderingContext2D,
  rawFirstName: string,
  rawLastName: string,
) {
  const first = rawFirstName.trim();
  const last = rawLastName.trim();
  if (!first && !last) return;

  // First Name is always line 1, Last Name is always line 2
  const lines: string[] = [];
  if (first) lines.push(first);
  if (last) lines.push(last);

  let fontSize: number = NAME_STYLE.fontSize;

  while (fontSize > NAME_STYLE.minFontSize) {
    ctx.font = `${NAME_STYLE.fontWeight} ${fontSize}px ${NAME_STYLE.fontFamily}`;
    const widestLine = Math.max(
      ...lines.map((line) => ctx.measureText(line).width),
    );
    if (widestLine <= NAME_STYLE.maxWidth) {
      break;
    }
    fontSize -= 1;
  }

  // Safeguard if a single uninterrupted string is still wider at minFontSize
  ctx.font = `${NAME_STYLE.fontWeight} ${fontSize}px ${NAME_STYLE.fontFamily}`;
  while (
    fontSize > 14 &&
    Math.max(...lines.map((line) => ctx.measureText(line).width)) >
      NAME_STYLE.maxWidth
  ) {
    fontSize -= 1;
    ctx.font = `${NAME_STYLE.fontWeight} ${fontSize}px ${NAME_STYLE.fontFamily}`;
  }

  ctx.save();
  ctx.font = `${NAME_STYLE.fontWeight} ${fontSize}px ${NAME_STYLE.fontFamily}`;
  ctx.fillStyle = NAME_STYLE.color;
  ctx.textAlign = NAME_STYLE.textAlign;
  ctx.textBaseline = 'top';
  ctx.shadowColor = NAME_STYLE.shadowColor;
  ctx.shadowBlur = NAME_STYLE.shadowBlur;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = NAME_STYLE.shadowOffsetY;

  const lineStep = fontSize * NAME_STYLE.lineHeight;
  lines.forEach((line, index) => {
    const lineIndex = !first && last ? 1 : index;
    ctx.fillText(line, NAME_STYLE.x, NAME_STYLE.y + lineIndex * lineStep);
  });
  ctx.restore();
}

interface PhotoCropModalProps {
  image: HTMLImageElement;
  initialCrop: PhotoCrop;
  onApply: (crop: PhotoCrop) => void;
  onCancel: () => void;
}

function PhotoCropModal({
  image,
  initialCrop,
  onApply,
  onCancel,
}: PhotoCropModalProps) {
  const cropCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [draftCrop, setDraftCrop] = useState<PhotoCrop>(initialCrop);

  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchStartRef = useRef<{ distance: number; zoom: number } | null>(null);
  const dragStartRef = useRef<{
    x: number;
    y: number;
    panX: number;
    panY: number;
  } | null>(null);

  const renderCropCanvas = useCallback(() => {
    const canvas = cropCanvasRef.current;
    if (!canvas) return;

    // 2x HiDPI resolution matching the exact PHOTO_BOX aspect ratio
    const scale = 2;
    const width = PHOTO_BOX.width * scale;
    const height = PHOTO_BOX.height * scale;

    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, width, height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    const placement = computeCoverPlacement(
      image.naturalWidth,
      image.naturalHeight,
      PHOTO_BOX.width,
      PHOTO_BOX.height,
      draftCrop,
    );

    ctx.save();
    drawRoundedRectPath(
      ctx,
      0,
      0,
      width,
      height,
      PHOTO_BOX.borderRadius * scale,
    );
    ctx.clip();

    ctx.fillStyle = '#C38B00';
    ctx.fillRect(0, 0, width, height);

    ctx.drawImage(
      image,
      placement.drawX * scale,
      placement.drawY * scale,
      placement.drawWidth * scale,
      placement.drawHeight * scale,
    );
    ctx.restore();
  }, [image, draftCrop]);

  useEffect(() => {
    renderCropCanvas();
  }, [renderCropCanvas]);

  const updateZoom = (nextZoomValue: number) => {
    const nextZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, nextZoomValue));
    setDraftCrop((prev) => {
      const placement = computeCoverPlacement(
        image.naturalWidth,
        image.naturalHeight,
        PHOTO_BOX.width,
        PHOTO_BOX.height,
        { ...prev, zoom: nextZoom },
      );
      return {
        zoom: nextZoom,
        panX: placement.clampedPanX,
        panY: placement.clampedPanY,
      };
    });
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointersRef.current.size === 1) {
      pinchStartRef.current = null;
      dragStartRef.current = {
        x: e.clientX,
        y: e.clientY,
        panX: draftCrop.panX,
        panY: draftCrop.panY,
      };
    } else if (pointersRef.current.size === 2) {
      dragStartRef.current = null;
      const pts = Array.from(pointersRef.current.values());
      const dx = pts[0].x - pts[1].x;
      const dy = pts[0].y - pts[1].y;
      pinchStartRef.current = {
        distance: Math.hypot(dx, dy),
        zoom: draftCrop.zoom,
      };
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!pointersRef.current.has(e.pointerId)) return;
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    const canvas = cropCanvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const boxPerScreenPx = rect.width > 0 ? PHOTO_BOX.width / rect.width : 1;

    if (pointersRef.current.size === 2 && pinchStartRef.current) {
      const pts = Array.from(pointersRef.current.values());
      const distance = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      if (pinchStartRef.current.distance > 0) {
        const scaleFactor = distance / pinchStartRef.current.distance;
        updateZoom(pinchStartRef.current.zoom * scaleFactor);
      }
      return;
    }

    if (pointersRef.current.size === 1 && dragStartRef.current) {
      const deltaX = (e.clientX - dragStartRef.current.x) * boxPerScreenPx;
      const deltaY = (e.clientY - dragStartRef.current.y) * boxPerScreenPx;

      const candidatePanX = dragStartRef.current.panX + deltaX;
      const candidatePanY = dragStartRef.current.panY + deltaY;

      setDraftCrop((prev) => {
        const placement = computeCoverPlacement(
          image.naturalWidth,
          image.naturalHeight,
          PHOTO_BOX.width,
          PHOTO_BOX.height,
          { ...prev, panX: candidatePanX, panY: candidatePanY },
        );
        return {
          ...prev,
          panX: placement.clampedPanX,
          panY: placement.clampedPanY,
        };
      });
    }
  };

  const handlePointerEnd = (e: React.PointerEvent<HTMLCanvasElement>) => {
    pointersRef.current.delete(e.pointerId);
    if (pointersRef.current.size < 2) {
      pinchStartRef.current = null;
    }
    if (pointersRef.current.size === 1) {
      const [remaining] = Array.from(pointersRef.current.values());
      dragStartRef.current = {
        x: remaining.x,
        y: remaining.y,
        panX: draftCrop.panX,
        panY: draftCrop.panY,
      };
    } else if (pointersRef.current.size === 0) {
      dragStartRef.current = null;
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="crop-modal-title"
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-xs p-0 sm:p-4"
    >
      <div className="w-full max-w-[430px] bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl border border-neutral-200 overflow-hidden flex flex-col max-h-[94dvh]">
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-neutral-100 flex items-center justify-between">
          <div>
            <h2
              id="crop-modal-title"
              className="text-base font-bold text-neutral-900"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              Crop &amp; Resize Photo
            </h2>
            <p className="text-xs text-neutral-500">
              Drag to move · Pinch or use slider to zoom
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Close crop editor"
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-full text-neutral-500 hover:text-neutral-900 hover:bg-neutral-100 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Interactive Crop Viewport */}
        <div className="px-5 py-5 bg-neutral-900/95 flex flex-col items-center justify-center">
          <div className="relative w-[220px] sm:w-[240px] aspect-[302/357] select-none">
            <canvas
              ref={cropCanvasRef}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerEnd}
              onPointerCancel={handlePointerEnd}
              style={{
                borderRadius: `${(PHOTO_BOX.borderRadius / PHOTO_BOX.width) * 100}% / ${(PHOTO_BOX.borderRadius / PHOTO_BOX.height) * 100}%`,
              }}
              className="w-full h-full block touch-none cursor-grab active:cursor-grabbing ring-2 ring-white/80 shadow-lg"
            />
          </div>
        </div>

        {/* Zoom & Actions */}
        <div className="px-5 py-4 space-y-4 bg-white">
          <div>
            <div className="flex items-center justify-between text-xs font-medium text-neutral-600 mb-2">
              <span>Zoom</span>
              <span className="tabular-nums font-semibold text-neutral-900">
                {Math.round(draftCrop.zoom * 100)}%
              </span>
            </div>
            <div className="flex items-center gap-2.5">
              <button
                type="button"
                onClick={() => updateZoom(draftCrop.zoom - 0.15)}
                disabled={draftCrop.zoom <= MIN_ZOOM}
                aria-label="Zoom out"
                className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl border border-neutral-200 text-neutral-700 hover:bg-neutral-100 disabled:opacity-40 cursor-pointer"
              >
                <Minus className="w-4 h-4" />
              </button>
              <input
                type="range"
                min={MIN_ZOOM}
                max={MAX_ZOOM}
                step={0.01}
                value={draftCrop.zoom}
                onChange={(e) => updateZoom(parseFloat(e.target.value))}
                aria-label="Zoom level"
                className="flex-1 h-2 bg-neutral-200 rounded-lg appearance-none cursor-pointer accent-[#990F27]"
              />
              <button
                type="button"
                onClick={() => updateZoom(draftCrop.zoom + 0.15)}
                disabled={draftCrop.zoom >= MAX_ZOOM}
                aria-label="Zoom in"
                className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl border border-neutral-200 text-neutral-700 hover:bg-neutral-100 disabled:opacity-40 cursor-pointer"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 pt-1">
            <button
              type="button"
              onClick={() => setDraftCrop(DEFAULT_CROP)}
              className="min-h-[48px] px-4 rounded-xl border border-neutral-300 text-sm font-semibold text-neutral-800 hover:bg-neutral-50 transition-colors cursor-pointer inline-flex items-center justify-center gap-2 whitespace-nowrap"
            >
              <RotateCcw className="w-4 h-4" aria-hidden="true" />
              <span>Reset Fit</span>
            </button>
            <button
              type="button"
              onClick={() => onApply(draftCrop)}
              className="min-h-[48px] px-4 rounded-xl bg-[#990F27] hover:bg-[#7D0B1F] text-white text-sm font-semibold transition-colors cursor-pointer inline-flex items-center justify-center gap-2 whitespace-nowrap shadow-sm"
            >
              <Check className="w-4 h-4" aria-hidden="true" />
              <span>Apply Photo</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const userImageUrlRef = useRef<string | null>(null);

  const [posterImage, setPosterImage] = useState<HTMLImageElement | null>(null);
  const [posterError, setPosterError] = useState<string | null>(null);
  const [fontsLoaded, setFontsLoaded] = useState(false);

  const [userImage, setUserImage] = useState<HTMLImageElement | null>(null);
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const [photoCrop, setPhotoCrop] = useState<PhotoCrop>(DEFAULT_CROP);
  const [isCropModalOpen, setIsCropModalOpen] = useState(false);

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [isDownloading, setIsDownloading] = useState(false);

  // Ensure fonts are loaded before drawing text onto Canvas
  useEffect(() => {
    let active = true;
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(() => {
        if (active) setFontsLoaded(true);
      });
    } else {
      setFontsLoaded(true);
    }
    return () => {
      active = false;
    };
  }, []);

  // Pre-load the base poster template on mount
  useEffect(() => {
    let active = true;
    const img = new Image();
    if (/^https?:\/\//i.test(POSTER_IMAGE_URL)) {
      img.crossOrigin = 'anonymous';
    }
    img.onload = () => {
      if (active) {
        setPosterImage(img);
        setPosterError(null);
      }
    };
    img.onerror = () => {
      if (active) {
        setPosterError('Unable to load the poster template image.');
      }
    };
    img.src = POSTER_IMAGE_URL;

    return () => {
      active = false;
    };
  }, []);

  // Clean up object URL on unmount & reset on mobile bfcache restore
  useEffect(() => {
    const handlePageShow = (event: PageTransitionEvent) => {
      if (event.persisted) {
        if (userImageUrlRef.current) {
          URL.revokeObjectURL(userImageUrlRef.current);
          userImageUrlRef.current = null;
        }
        setUserImage(null);
        setUploadedFileName(null);
        setUploadError(null);
        setPhotoCrop(DEFAULT_CROP);
        setIsCropModalOpen(false);
        setFirstName('');
        setLastName('');
      }
    };
    window.addEventListener('pageshow', handlePageShow);

    return () => {
      window.removeEventListener('pageshow', handlePageShow);
      if (userImageUrlRef.current) {
        URL.revokeObjectURL(userImageUrlRef.current);
      }
    };
  }, []);

  // Re-render full-resolution HTML5 Canvas whenever poster, photo, crop, or name changes
  const renderPosterCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !posterImage) return;

    const width = posterImage.naturalWidth;
    const height = posterImage.naturalHeight;

    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, width, height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    // 1. Draw full-resolution base poster template
    ctx.drawImage(posterImage, 0, 0, width, height);

    // 2. Draw user photo using cover scaling + user crop & zoom inside PHOTO_BOX
    if (userImage) {
      const placement = computeCoverPlacement(
        userImage.naturalWidth,
        userImage.naturalHeight,
        PHOTO_BOX.width,
        PHOTO_BOX.height,
        photoCrop,
      );

      ctx.save();
      drawRoundedRectPath(
        ctx,
        PHOTO_BOX.x,
        PHOTO_BOX.y,
        PHOTO_BOX.width,
        PHOTO_BOX.height,
        PHOTO_BOX.borderRadius,
      );
      ctx.clip();
      ctx.drawImage(
        userImage,
        PHOTO_BOX.x + placement.drawX,
        PHOTO_BOX.y + placement.drawY,
        placement.drawWidth,
        placement.drawHeight,
      );
      ctx.restore();
    }

    // 3. Draw First Name (line 1) & Last Name (line 2) directly below PHOTO_BOX
    if (firstName.trim() || lastName.trim()) {
      drawFirstAndLastName(ctx, firstName, lastName);
    }
  }, [posterImage, userImage, photoCrop, firstName, lastName, fontsLoaded]);

  useEffect(() => {
    renderPosterCanvas();
  }, [renderPosterCanvas]);

  const processSelectedFile = (file: File | undefined | null) => {
    if (!file) return;

    const isSupported =
      ACCEPTED_IMAGE_TYPES.includes(file.type) ||
      /\.(jpe?g|png|webp)$/i.test(file.name);
    if (!isSupported) {
      setUploadError('Please upload a JPG, PNG, or WebP image.');
      return;
    }

    const objectUrl = URL.createObjectURL(file);
    const img = new Image();

    img.onload = () => {
      if (userImageUrlRef.current) {
        URL.revokeObjectURL(userImageUrlRef.current);
      }
      userImageUrlRef.current = objectUrl;
      setUserImage(img);
      setUploadedFileName(file.name);
      setUploadError(null);
      setPhotoCrop(DEFAULT_CROP);
      // Immediately open interactive Crop & Resize tool on upload
      setIsCropModalOpen(true);
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      setUploadError('Could not read that image file. Try another photo.');
    };

    img.src = objectUrl;
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    processSelectedFile(file);
    event.target.value = '';
  };

  const handleDragOver = (event: React.DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (event: React.DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (event: React.DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setIsDragging(false);
    const file = event.dataTransfer.files?.[0];
    processSelectedFile(file);
  };

  const handleClearPhoto = () => {
    if (userImageUrlRef.current) {
      URL.revokeObjectURL(userImageUrlRef.current);
      userImageUrlRef.current = null;
    }
    setUserImage(null);
    setUploadedFileName(null);
    setUploadError(null);
    setPhotoCrop(DEFAULT_CROP);
    setIsCropModalOpen(false);
  };

  const handleResetAll = () => {
    handleClearPhoto();
    setFirstName('');
    setLastName('');
  };

  const handleDownloadPoster = () => {
    const canvas = canvasRef.current;
    if (!canvas || !posterImage || isDownloading) return;

    setIsDownloading(true);
    renderPosterCanvas();

    const fullName = `${firstName.trim()} ${lastName.trim()}`.trim();
    const safeSlug = fullName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    const downloadFileName = safeSlug
      ? `sibaq-26-poster-${safeSlug}.png`
      : 'sibaq-26-poster.png';

    const triggerDownload = (href: string, revokeAfter?: () => void) => {
      const link = document.createElement('a');
      link.download = downloadFileName;
      link.href = href;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      if (revokeAfter) {
        window.setTimeout(revokeAfter, 1000);
      }
      setIsDownloading(false);
    };

    if (typeof canvas.toBlob === 'function') {
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            triggerDownload(canvas.toDataURL('image/png'));
            return;
          }
          const url = URL.createObjectURL(blob);
          triggerDownload(url, () => URL.revokeObjectURL(url));
        },
        'image/png',
        1.0,
      );
    } else {
      triggerDownload(canvas.toDataURL('image/png'));
    }
  };

  const hasCustomizations = Boolean(
    userImage || firstName.trim() || lastName.trim(),
  );

  return (
    <div className="min-h-dvh bg-[#E8E6E3] text-[#141414] flex justify-center sm:py-5 sm:px-4">
      {/* 9:16 Mobile-Proportioned Frame (Full-screen on phones, centered phone viewport on larger screens) */}
      <div className="w-full max-w-[430px] min-h-dvh sm:min-h-[760px] bg-[#FAFAFA] sm:rounded-[32px] sm:border sm:border-neutral-300/80 sm:shadow-[0_24px_60px_-15px_rgba(20,20,20,0.2)] flex flex-col overflow-hidden">
        {/* Compact Mobile Top Bar */}
        <header className="h-13 px-4 bg-white/95 backdrop-blur-sm border-b border-neutral-200/80 flex items-center justify-between gap-3 shrink-0">
          <h1
            className="text-base font-bold tracking-tight text-neutral-900 truncate"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            Sibaq &apos;26 Poster
          </h1>
          <div className="flex items-center gap-2 shrink-0">
            {hasCustomizations ? (
              <button
                type="button"
                onClick={handleResetAll}
                className="min-h-[40px] px-2.5 inline-flex items-center gap-1.5 text-xs font-semibold text-neutral-700 hover:text-neutral-950 rounded-lg hover:bg-neutral-100 transition-colors cursor-pointer whitespace-nowrap"
              >
                <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Reset</span>
              </button>
            ) : (
              <span className="text-xs text-neutral-500 whitespace-nowrap">
                Darul Huda
              </span>
            )}
          </div>
        </header>

        {/* Scrollable Content */}
        <main className="flex-1 px-4 pt-4 pb-6 flex flex-col gap-4">
          {/* 1. Live Poster Canvas Preview (Top / Center) */}
          <section aria-label="Live Poster Preview" className="w-full">
            <div className="w-full bg-white p-1.5 rounded-2xl border border-neutral-200/90 shadow-sm">
              <div className="relative w-full overflow-hidden rounded-xl bg-neutral-100 aspect-[1792/2400]">
                {!posterImage && !posterError && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-neutral-500 text-sm">
                    <div className="w-7 h-7 rounded-full border-2 border-neutral-300 border-t-neutral-700 animate-spin" />
                    <span>Loading poster...</span>
                  </div>
                )}

                {posterError && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center p-5 text-center text-sm text-rose-800 bg-rose-50">
                    <p className="font-semibold">Template unavailable</p>
                    <p className="mt-1 text-rose-700">{posterError}</p>
                  </div>
                )}

                <canvas
                  ref={canvasRef}
                  aria-label="Personalized Sibaq 26 poster preview"
                  className={`w-full h-full block transition-opacity duration-200 ${
                    posterImage ? 'opacity-100' : 'opacity-0'
                  }`}
                />
              </div>
            </div>
          </section>

          {/* 2. Personalization Inputs Placed Directly Below the Poster */}
          <form
            autoComplete="off"
            onSubmit={(e) => e.preventDefault()}
            className="bg-white rounded-2xl border border-neutral-200/90 shadow-sm p-4 space-y-4"
          >
            {/* Option 1: Upload Your Image + Crop & Resize */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label
                  htmlFor="poster-photo-upload"
                  className="text-sm font-semibold text-neutral-900"
                >
                  Upload Your Image
                </label>
                {uploadedFileName && (
                  <button
                    type="button"
                    onClick={handleClearPhoto}
                    className="inline-flex items-center gap-1 text-xs font-medium text-neutral-500 hover:text-neutral-900 transition-colors cursor-pointer px-1.5 py-1 rounded"
                  >
                    <X className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Remove</span>
                  </button>
                )}
              </div>

              <label
                htmlFor="poster-photo-upload"
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                className={`flex items-center justify-between gap-2.5 w-full min-h-[52px] px-3.5 py-2.5 rounded-xl border transition-colors cursor-pointer ${
                  isDragging
                    ? 'border-rose-700 bg-rose-50/60'
                    : uploadedFileName
                      ? 'border-neutral-300 bg-neutral-50/70 hover:bg-neutral-100/70'
                      : 'border-dashed border-neutral-300 bg-neutral-50/50 hover:border-neutral-400 hover:bg-neutral-50'
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="flex items-center justify-center w-9 h-9 rounded-lg bg-white border border-neutral-200 text-neutral-700 shrink-0">
                    <ImagePlus className="w-4 h-4" aria-hidden="true" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-neutral-900 truncate">
                      {uploadedFileName || 'Choose photo from phone'}
                    </p>
                    <p className="text-xs text-neutral-500 truncate">
                      JPG, PNG, or WebP
                    </p>
                  </div>
                </div>
                <span className="text-xs font-semibold text-rose-900 bg-rose-50 border border-rose-200/80 rounded-lg px-2.5 py-1.5 whitespace-nowrap shrink-0">
                  {uploadedFileName ? 'Change' : 'Upload'}
                </span>
                <input
                  id="poster-photo-upload"
                  type="file"
                  accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
                  onChange={handleFileChange}
                  className="sr-only"
                />
              </label>

              {userImage && (
                <button
                  type="button"
                  onClick={() => setIsCropModalOpen(true)}
                  className="mt-2 w-full min-h-[44px] px-3.5 rounded-xl border border-neutral-300 bg-neutral-50 hover:bg-neutral-100 text-xs sm:text-sm font-semibold text-neutral-800 inline-flex items-center justify-center gap-2 transition-colors cursor-pointer whitespace-nowrap"
                >
                  <Crop className="w-4 h-4 text-rose-800" aria-hidden="true" />
                  <span>Crop &amp; Resize Photo</span>
                </button>
              )}

              {uploadError && (
                <p
                  role="alert"
                  className="mt-1.5 text-xs font-medium text-rose-700"
                >
                  {uploadError}
                </p>
              )}
            </div>

            {/* Option 2A: Enter Your First Name (Always Line 1) */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label
                  htmlFor="poster-first-name"
                  className="text-sm font-semibold text-neutral-900"
                >
                  Enter Your First Name
                </label>
                {firstName && (
                  <button
                    type="button"
                    onClick={() => setFirstName('')}
                    className="inline-flex items-center gap-1 text-xs font-medium text-neutral-500 hover:text-neutral-900 transition-colors cursor-pointer px-1 py-0.5 rounded"
                  >
                    <X className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Clear</span>
                  </button>
                )}
              </div>

              <div className="relative">
                <User
                  className="w-4 h-4 text-neutral-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
                  aria-hidden="true"
                />
                <input
                  id="poster-first-name"
                  name="poster-first-name"
                  type="text"
                  autoComplete="off"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  placeholder="e.g. Rahbar"
                  maxLength={32}
                  className="w-full min-h-[46px] pl-10 pr-4 py-2 rounded-xl border border-neutral-300 bg-white text-sm text-neutral-900 placeholder:text-neutral-400 focus:outline-none focus:border-rose-800 focus:ring-2 focus:ring-rose-800/20 transition-shadow"
                />
              </div>
            </div>

            {/* Option 2B: Enter Your Last Name (Always Line 2) */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label
                  htmlFor="poster-last-name"
                  className="text-sm font-semibold text-neutral-900"
                >
                  Enter Your Last Name
                </label>
                {lastName && (
                  <button
                    type="button"
                    onClick={() => setLastName('')}
                    className="inline-flex items-center gap-1 text-xs font-medium text-neutral-500 hover:text-neutral-900 transition-colors cursor-pointer px-1 py-0.5 rounded"
                  >
                    <X className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Clear</span>
                  </button>
                )}
              </div>

              <div className="relative">
                <User
                  className="w-4 h-4 text-neutral-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
                  aria-hidden="true"
                />
                <input
                  id="poster-last-name"
                  name="poster-last-name"
                  type="text"
                  autoComplete="off"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  placeholder="e.g. Islam"
                  maxLength={32}
                  className="w-full min-h-[46px] pl-10 pr-4 py-2 rounded-xl border border-neutral-300 bg-white text-sm text-neutral-900 placeholder:text-neutral-400 focus:outline-none focus:border-rose-800 focus:ring-2 focus:ring-rose-800/20 transition-shadow"
                />
              </div>
            </div>

            {/* Option 3: Download Poster */}
            <div className="pt-1">
              <button
                type="button"
                onClick={handleDownloadPoster}
                disabled={!posterImage || isDownloading}
                className="w-full min-h-[48px] px-5 py-3 rounded-xl bg-[#990F27] hover:bg-[#7D0B1F] active:scale-[0.99] disabled:opacity-50 disabled:pointer-events-none text-white text-sm font-semibold inline-flex items-center justify-center gap-2 transition-all duration-150 cursor-pointer whitespace-nowrap shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-rose-800"
              >
                <Download className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span>
                  {isDownloading ? 'Preparing PNG...' : 'Download Poster'}
                </span>
              </button>
              {posterImage && (
                <p className="mt-2 text-center text-xs text-neutral-500 tabular-nums">
                  Full-resolution PNG ({posterImage.naturalWidth} ×{' '}
                  {posterImage.naturalHeight} px)
                </p>
              )}
            </div>
          </form>
        </main>
      </div>

      {/* Interactive Crop & Resize Modal (Auto-opens on image upload) */}
      {isCropModalOpen && userImage && (
        <PhotoCropModal
          image={userImage}
          initialCrop={photoCrop}
          onApply={(nextCrop) => {
            setPhotoCrop(nextCrop);
            setIsCropModalOpen(false);
          }}
          onCancel={() => setIsCropModalOpen(false)}
        />
      )}
    </div>
  );
}
