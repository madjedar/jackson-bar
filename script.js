// =========================================================================
// JACKSON BAR — MAIN APPLICATION SCRIPT
// =========================================================================

const STORAGE_KEY = 'jb_course_orders';
const ADMIN_PASSWORD = 'yacine123';

const COURSE_PRICE_MAP = {
    'Classic Bar': '15,000 DZD',
    'Extra Barman': '20,000 DZD',
    'Golden Barman': '30,000 DZD'
};

// =========================================================================
// 1. INDEXEDDB DATABASE LAYER (NO 5MB QUOTA LIMIT — CAN STORE GIGABYTES)
// =========================================================================
const DB_NAME = 'JacksonBarDB';
const DB_VERSION = 2;

function openJBDatabase() {
    return new Promise((resolve) => {
        if (!window.indexedDB) {
            console.warn('IndexedDB not supported in this browser environment.');
            resolve(null);
            return;
        }
        try {
            const req = indexedDB.open(DB_NAME, DB_VERSION);
            req.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains('mediaStore')) {
                    db.createObjectStore('mediaStore');
                }
                if (!db.objectStoreNames.contains('ordersStore')) {
                    db.createObjectStore('ordersStore');
                }
                if (!db.objectStoreNames.contains('galleryStore')) {
                    db.createObjectStore('galleryStore');
                }
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = (err) => {
                console.warn('IndexedDB open error:', err);
                resolve(null);
            };
        } catch (err) {
            console.warn('IndexedDB initialization exception:', err);
            resolve(null);
        }
    });
}

async function idbGet(storeName, key) {
    try {
        const db = await openJBDatabase();
        if (!db) return null;
        return new Promise((resolve) => {
            const tx = db.transaction(storeName, 'readonly');
            const store = tx.objectStore(storeName);
            const req = store.get(key);
            req.onsuccess = () => resolve(req.result !== undefined ? req.result : null);
            req.onerror = () => resolve(null);
        });
    } catch (e) {
        console.warn('idbGet failed', e);
        return null;
    }
}

async function idbSet(storeName, key, value) {
    try {
        const db = await openJBDatabase();
        if (!db) return false;
        return new Promise((resolve) => {
            const tx = db.transaction(storeName, 'readwrite');
            const store = tx.objectStore(storeName);
            const req = store.put(value, key);
            req.onsuccess = () => resolve(true);
            req.onerror = () => resolve(false);
        });
    } catch (e) {
        console.warn('idbSet failed', e);
        return false;
    }
}

async function idbDelete(storeName, key) {
    try {
        const db = await openJBDatabase();
        if (!db) return false;
        return new Promise((resolve) => {
            const tx = db.transaction(storeName, 'readwrite');
            const store = tx.objectStore(storeName);
            const req = store.delete(key);
            req.onsuccess = () => resolve(true);
            req.onerror = () => resolve(false);
        });
    } catch (e) {
        return false;
    }
}

// =========================================================================
// 2. CLIENT-SIDE CANVAS IMAGE COMPRESSION HELPER
// Shrinks large phone camera photos (10MB+) into high-quality JPEG (~300-600KB)
// =========================================================================
function compressImageFile(file, maxWidth = 1920, maxHeight = 1920, quality = 0.85) {
    return new Promise((resolve) => {
        if (!file || !file.type || !file.type.startsWith('image/')) {
            resolve(file);
            return;
        }
        // If file is already small (under 400KB), keep as is
        if (file.size <= 400 * 1024) {
            resolve(file);
            return;
        }

        const img = new Image();
        const objUrl = URL.createObjectURL(file);
        img.onload = () => {
            URL.revokeObjectURL(objUrl);
            let width = img.width;
            let height = img.height;

            if (width > maxWidth || height > maxHeight) {
                if (width / maxWidth > height / maxHeight) {
                    height = Math.round((height * maxWidth) / width);
                    width = maxWidth;
                } else {
                    width = Math.round((width * maxHeight) / height);
                    height = maxHeight;
                }
            }

            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);

            canvas.toBlob((blob) => {
                if (blob && blob.size < file.size) {
                    const cleanName = file.name.replace(/\.[^.]+$/, '.jpg');
                    resolve(new File([blob], cleanName, { type: 'image/jpeg' }));
                } else {
                    resolve(file);
                }
            }, 'image/jpeg', quality);
        };
        img.onerror = () => {
            URL.revokeObjectURL(objUrl);
            resolve(file);
        };
        img.src = objUrl;
    });
}

// =========================================================================
// 3. ORDERS STORAGE & MULTI-TIER SYNC (FIREBASE FIRESTORE)
// =========================================================================
let cachedOrders = [];

function getOrders() {
    return cachedOrders;
}

async function saveOrders(orders) {
    cachedOrders = orders;
    updateNavBadge();
    if (typeof renderAdminPanel === 'function') renderAdminPanel();
    // In Firebase, adding a new order is an addDoc operation.
    // The real-time listener will sync it back to cachedOrders, but we update cache instantly for fast UI.
}

async function syncOrdersFromDatabase() {
    if (!window.fb) {
        // Retry in 100ms if Firebase isn't ready
        setTimeout(syncOrdersFromDatabase, 100);
        return;
    }
    const { db, collection, onSnapshot, query, orderBy } = window.fb;
    const ordersRef = collection(db, "orders");
    const q = query(ordersRef, orderBy("timestamp", "desc"));
    
    // Set up real-time listener
    onSnapshot(q, (snapshot) => {
        const orders = [];
        snapshot.forEach((doc) => {
            const data = doc.data();
            data.firebaseId = doc.id; // Keep track of the document ID for updates/deletes
            orders.push(data);
        });
        cachedOrders = orders;
        updateNavBadge();
        if (typeof renderAdminPanel === 'function') renderAdminPanel();
    });
}

// =========================================================================
// 4. SITE MEDIA & CONTENT STORAGE (TOP VIDEO & COURSE SHOWCASE IMAGES)
// =========================================================================
const MEDIA_STORAGE_KEY = 'jb_site_media';
const DEFAULT_MEDIA = {
    topVideo: 'assets/bg-video.mp4',
    course1Img: 'assets/course-classic-bar.jpg',
    course2Img: 'assets/course-extra-barman.jpg'
};

let currentSiteMedia = { ...DEFAULT_MEDIA };
const mediaBlobUrlMap = new Map();

async function resolveMediaUrl(val, fallback) {
    if (!val) return fallback;
    if (val.startsWith('idb:')) {
        const key = val.replace('idb:', '');
        if (mediaBlobUrlMap.has(key)) {
            return mediaBlobUrlMap.get(key);
        }
        const blob = await idbGet('mediaStore', key);
        if (blob) {
            const objUrl = URL.createObjectURL(blob);
            mediaBlobUrlMap.set(key, objUrl);
            return objUrl;
        }
        return fallback;
    }
    return val;
}

function getSiteMedia() {
    try {
        const raw = localStorage.getItem(MEDIA_STORAGE_KEY);
        if (!raw) return { ...DEFAULT_MEDIA };
        const parsed = JSON.parse(raw);
        return {
            topVideo: parsed.topVideo || DEFAULT_MEDIA.topVideo,
            course1Img: parsed.course1Img || DEFAULT_MEDIA.course1Img,
            course2Img: parsed.course2Img || DEFAULT_MEDIA.course2Img
        };
    } catch (e) {
        return { ...DEFAULT_MEDIA };
    }
}

async function applySiteMedia() {
    const media = currentSiteMedia || getSiteMedia();

    // 1. Update Top Video
    const topVideo = document.getElementById('top-featured-video');
    if (topVideo) {
        const resolvedVideo = await resolveMediaUrl(media.topVideo, DEFAULT_MEDIA.topVideo);
        const currentSrc = topVideo.getAttribute('data-active-src');
        if (currentSrc !== resolvedVideo) {
            topVideo.setAttribute('data-active-src', resolvedVideo);
            topVideo.innerHTML = `<source src="${resolvedVideo}" type="video/mp4">Your browser does not support the video tag.`;
            topVideo.load();
        }
    }

    // 2. Update Course 1 Image
    const c1Img = document.getElementById('course-1-img');
    if (c1Img) {
        const resolvedC1 = await resolveMediaUrl(media.course1Img, DEFAULT_MEDIA.course1Img);
        c1Img.src = resolvedC1;
    }

    // 3. Update Course 2 Image
    const c2Img = document.getElementById('course-2-img');
    if (c2Img) {
        const resolvedC2 = await resolveMediaUrl(media.course2Img, DEFAULT_MEDIA.course2Img);
        c2Img.src = resolvedC2;
    }

    // 4. Update Admin input values & preview images if present
    const inputTopVideo = document.getElementById('media-top-video-url');
    const inputC1 = document.getElementById('media-c1-url');
    const inputC2 = document.getElementById('media-c2-url');
    const prevC1 = document.getElementById('preview-c1-img');
    const prevC2 = document.getElementById('preview-c2-img');

    if (inputTopVideo) {
        inputTopVideo.value = (media.topVideo && !media.topVideo.startsWith('idb:') && !media.topVideo.startsWith('data:')) ? media.topVideo : '';
    }
    if (inputC1) {
        inputC1.value = (media.course1Img && !media.course1Img.startsWith('idb:') && !media.course1Img.startsWith('data:')) ? media.course1Img : '';
    }
    if (inputC2) {
        inputC2.value = (media.course2Img && !media.course2Img.startsWith('idb:') && !media.course2Img.startsWith('data:')) ? media.course2Img : '';
    }

    if (prevC1) {
        const c1Url = await resolveMediaUrl(media.course1Img, DEFAULT_MEDIA.course1Img);
        prevC1.src = c1Url;
    }
    if (prevC2) {
        const c2Url = await resolveMediaUrl(media.course2Img, DEFAULT_MEDIA.course2Img);
        prevC2.src = c2Url;
    }
}

async function initSiteMedia() {
    // A. Instant quick load from localStorage
    try {
        const raw = localStorage.getItem(MEDIA_STORAGE_KEY);
        if (raw) {
            currentSiteMedia = { ...DEFAULT_MEDIA, ...JSON.parse(raw) };
            await applySiteMedia();
        }
    } catch (e) {}

    // B. Listen to Firebase Realtime Updates
    if (window.fb) {
        const docRef = window.fb.doc(window.fb.db, "settings", "media");
        window.fb.onSnapshot(docRef, (docSnap) => {
            if (docSnap.exists()) {
                const serverMedia = docSnap.data();
                if (serverMedia && (serverMedia.topVideo || serverMedia.course1Img || serverMedia.course2Img)) {
                    currentSiteMedia = {
                        topVideo: serverMedia.topVideo || DEFAULT_MEDIA.topVideo,
                        course1Img: serverMedia.course1Img || DEFAULT_MEDIA.course1Img,
                        course2Img: serverMedia.course2Img || DEFAULT_MEDIA.course2Img
                    };
                    try {
                        localStorage.setItem(MEDIA_STORAGE_KEY, JSON.stringify(currentSiteMedia));
                    } catch (e) {}
                    idbSet('mediaStore', 'active_media', currentSiteMedia);
                    applySiteMedia();
                }
            }
        });
        return;
    }

    // C. Fallback to IndexedDB (if no Firebase)
    try {
        const idbMedia = await idbGet('mediaStore', 'active_media');
        if (idbMedia && (idbMedia.topVideo || idbMedia.course1Img || idbMedia.course2Img)) {
            currentSiteMedia = {
                topVideo: idbMedia.topVideo || DEFAULT_MEDIA.topVideo,
                course1Img: idbMedia.course1Img || DEFAULT_MEDIA.course1Img,
                course2Img: idbMedia.course2Img || DEFAULT_MEDIA.course2Img
            };
            await applySiteMedia();
            return;
        }
    } catch (e) {}

    // D. Default fallback
    await applySiteMedia();
}

// =========================================================================
// 5. COURSE GALLERY SYSTEM (Up to 20 photos per course)
// =========================================================================
const GALLERY_STORAGE_KEY = 'jb_gallery';

// Gallery data structure: { classicBar: ['url1', ...], extraBarman: ['url1', ...] }
let galleryData = { classicBar: [], extraBarman: [] };

function getGalleryData() {
    try {
        const raw = localStorage.getItem(GALLERY_STORAGE_KEY);
        if (!raw) return { classicBar: [], extraBarman: [] };
        const parsed = JSON.parse(raw);
        return {
            classicBar: Array.isArray(parsed.classicBar) ? parsed.classicBar : [],
            extraBarman: Array.isArray(parsed.extraBarman) ? parsed.extraBarman : []
        };
    } catch (e) {
        return { classicBar: [], extraBarman: [] };
    }
}

function saveGalleryData(data) {
    galleryData = data;
    try {
        localStorage.setItem(GALLERY_STORAGE_KEY, JSON.stringify(data));
    } catch (e) {}
    idbSet('galleryStore', 'gallery_data', data);
    
    // Sync to Firebase
    if (window.fb) {
        window.fb.setDoc(window.fb.doc(window.fb.db, "settings", "gallery"), data, { merge: true })
            .catch(e => console.error("Firebase sync error:", e));
    }
}

function renderPublicGallery(courseKey, gridId, countId) {
    const grid = document.getElementById(gridId);
    const countEl = document.getElementById(countId);
    if (!grid) return;

    const photos = galleryData[courseKey] || [];
    if (countEl) countEl.textContent = `${photos.length} photo${photos.length !== 1 ? 's' : ''}`;

    if (photos.length === 0) {
        grid.innerHTML = `<div class="gallery-empty"><i class="fas fa-camera-retro"></i><span>Gallery photos coming soon</span></div>`;
        return;
    }

    grid.innerHTML = photos.map((url, idx) => `
        <div class="gallery-grid-item" onclick="openLightbox('${courseKey}', ${idx})">
            <img src="${url}" alt="Course Photo ${idx + 1}" loading="lazy">
            <div class="gallery-zoom-icon"><i class="fas fa-search-plus"></i></div>
        </div>
    `).join('');
}

function renderAllPublicGalleries() {
    renderPublicGallery('classicBar', 'gallery-grid-classic', 'gallery-count-classic');
    renderPublicGallery('extraBarman', 'gallery-grid-extra', 'gallery-count-extra');
}

function renderAdminGallery(courseKey, gridId, countId) {
    const grid = document.getElementById(gridId);
    const countEl = document.getElementById(countId);
    if (!grid) return;

    const photos = galleryData[courseKey] || [];
    if (countEl) countEl.textContent = `${photos.length} / 20`;

    if (photos.length === 0) {
        grid.innerHTML = `<div class="gallery-empty"><i class="fas fa-image"></i><span>No photos uploaded yet</span></div>`;
        return;
    }

    grid.innerHTML = photos.map((url, idx) => `
        <div class="gallery-admin-item">
            <img src="${url}" alt="Photo ${idx + 1}">
            <button type="button" class="gallery-delete-btn" onclick="deleteGalleryPhoto('${courseKey}', ${idx})" title="Delete photo">
                <i class="fas fa-times"></i>
            </button>
        </div>
    `).join('');
}

function renderAllAdminGalleries() {
    renderAdminGallery('classicBar', 'admin-gallery-grid-classic', 'admin-gallery-count-classic');
    renderAdminGallery('extraBarman', 'admin-gallery-grid-extra', 'admin-gallery-count-extra');
}

async function initGallery() {
    // 1. Quick load from localStorage
    galleryData = getGalleryData();
    renderAllPublicGalleries();

    // 2. Listen to Firebase Realtime Updates
    if (window.fb) {
        const docRef = window.fb.doc(window.fb.db, "settings", "gallery");
        window.fb.onSnapshot(docRef, (docSnap) => {
            if (docSnap.exists()) {
                const serverData = docSnap.data();
                if (serverData && (serverData.classicBar || serverData.extraBarman)) {
                    galleryData = {
                        classicBar: Array.isArray(serverData.classicBar) ? serverData.classicBar : [],
                        extraBarman: Array.isArray(serverData.extraBarman) ? serverData.extraBarman : []
                    };
                    try { localStorage.setItem(GALLERY_STORAGE_KEY, JSON.stringify(galleryData)); } catch (e) {}
                    idbSet('galleryStore', 'gallery_data', galleryData);
                    renderAllPublicGalleries();
                    renderAllAdminGalleries();
                }
            }
        });
        return;
    }

    // 3. Fallback to IndexedDB (if no firebase)
    try {
        const idbData = await idbGet('galleryStore', 'gallery_data');
        if (idbData && (idbData.classicBar || idbData.extraBarman)) {
            galleryData = {
                classicBar: Array.isArray(idbData.classicBar) ? idbData.classicBar : [],
                extraBarman: Array.isArray(idbData.extraBarman) ? idbData.extraBarman : []
            };
            renderAllPublicGalleries();
            renderAllAdminGalleries();
        }
    } catch (e) {}
}

// Helper: Format Date
function formatDate(isoString) {
    if (!isoString) return 'Just now';
    try {
        const d = new Date(isoString);
        return d.toLocaleDateString('en-GB', {
            day: 'numeric',
            month: 'short',
            hour: '2-digit',
            minute: '2-digit'
        });
    } catch (e) {
        return isoString;
    }
}

// Helper: WhatsApp URL generator
function getWhatsAppUrl(rawPhone, studentName, courseName) {
    let clean = (rawPhone || '').replace(/\D/g, '');
    if (clean.startsWith('0') && clean.length === 10) {
        clean = '213' + clean.substring(1);
    }
    const msg = encodeURIComponent(`Hello ${studentName}! This is Jackson Bar Academy regarding your enrollment in the ${courseName} course.`);
    return `https://wa.me/${clean}?text=${msg}`;
}

// Helper: Update Top Nav Badge
function updateNavBadge() {
    const badge = document.getElementById('nav-order-badge');
    if (!badge) return;
    const orders = getOrders();
    if (orders.length > 0) {
        badge.textContent = orders.length;
        badge.style.display = 'inline-flex';
    } else {
        badge.style.display = 'none';
    }
}

// =========================================================================
// DOM CONTENT LOADED INITIALIZATION
// =========================================================================
document.addEventListener('DOMContentLoaded', () => {

    // ---------------------------------------------------------------------
    // 1. BACKGROUND MUSIC & AUDIO AUTOPLAY (Starts at 00:15 & Loops from 00:15)
    // ---------------------------------------------------------------------
    const audio = document.getElementById('bg-audio');
    const musicBtn = document.getElementById('music-toggle');
    const musicIcon = musicBtn ? musicBtn.querySelector('i') : null;

    if (audio) {
        audio.volume = 0.5;
        const START_TIME = 15; // Set to 00:15

        // Safely seek to 00:15
        const seekToStartTime = () => {
            try {
                if (audio.currentTime < START_TIME) {
                    audio.currentTime = START_TIME;
                }
            } catch (e) {
                // Will retry on loadedmetadata / canplay
            }
        };

        // When audio metadata is loaded, set initial seek time to 00:15
        audio.addEventListener('loadedmetadata', seekToStartTime);
        audio.addEventListener('canplay', () => {
            if (audio.currentTime < START_TIME) {
                seekToStartTime();
            }
        });

        if (audio.readyState >= 1) {
            seekToStartTime();
        }

        // Loop automatically from 00:15 when song ends
        audio.addEventListener('ended', () => {
            audio.currentTime = START_TIME;
            audio.play().then(() => {
                updateMusicIcon(true);
            }).catch(() => {});
        });

        const updateMusicIcon = (isPlaying) => {
            if (!musicIcon) return;
            if (isPlaying) {
                musicIcon.classList.remove('fa-volume-mute');
                musicIcon.classList.add('fa-volume-up');
            } else {
                musicIcon.classList.remove('fa-volume-up');
                musicIcon.classList.add('fa-volume-mute');
            }
        };

        const playAudio = () => {
            seekToStartTime();
            return audio.play().then(() => {
                updateMusicIcon(true);
            }).catch((err) => {
                updateMusicIcon(false);
                throw err;
            });
        };

        const togglePlay = () => {
            if (audio.paused) {
                seekToStartTime();
                audio.play().then(() => {
                    updateMusicIcon(true);
                }).catch(() => {});
            } else {
                audio.pause();
                updateMusicIcon(false);
            }
        };

        if (musicBtn) {
            musicBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                togglePlay();
            });
        }

        // Try playing immediately upon consulting website
        playAudio().catch(() => {
            // Autoplay prevented by browser security policy until user gesture
        });

        // Start on first user interaction anywhere on the website
        const startOnFirstGesture = () => {
            if (audio.paused) {
                playAudio().catch(() => {});
            }
        };

        ['click', 'touchstart', 'pointerdown', 'keydown'].forEach(evt => {
            document.addEventListener(evt, startOnFirstGesture, { once: true, passive: true });
        });
    }

    // Ensure background video plays seamlessly
    const bgVideo = document.querySelector('.bg-video-main');
    if (bgVideo && bgVideo.paused) {
        bgVideo.play().catch(() => {});
    }

    // ---------------------------------------------------------------------
    // 2. SMOOTH SCROLLING FOR INTERNAL ANCHORS
    // ---------------------------------------------------------------------
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function(e) {
            const targetId = this.getAttribute('href');
            if (targetId && targetId !== '#') {
                e.preventDefault();
                const el = document.querySelector(targetId);
                if (el) {
                    el.scrollIntoView({ behavior: 'smooth' });
                }
            }
        });
    });

    // ---------------------------------------------------------------------
    // 3. COURSE REGISTRATION FORMULAR (FOOLPROOF IN-PAGE HANDLING)
    // ---------------------------------------------------------------------
    const inlineForm = document.getElementById('inline-enroll-form');
    const inlineCourseSelect = document.getElementById('inline-course-select');
    const inlineStudentName = document.getElementById('inline-student-name');
    const inlineStudentPhone = document.getElementById('inline-student-phone');
    const inlinePriceDisplay = document.getElementById('inline-price-display');
    const inlineSubmitBtn = document.getElementById('inline-submit-btn');

    const inlineNameError = document.getElementById('inline-name-error');
    const inlinePhoneError = document.getElementById('inline-phone-error');

    const inlineSuccessCard = document.getElementById('inline-success-card');
    const btnOrderAnother = document.getElementById('btn-order-another');
    const enrollFormCard = document.getElementById('enroll-form-card');

    // Update displayed price when course changes
    if (inlineCourseSelect && inlinePriceDisplay) {
        inlineCourseSelect.addEventListener('change', () => {
            const course = inlineCourseSelect.value;
            inlinePriceDisplay.textContent = COURSE_PRICE_MAP[course] || '15,000 DZD';
        });
    }

    // When clicking "Enroll Now" on course cards, jump to form and preselect course
    document.querySelectorAll('.enroll-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            const course = btn.getAttribute('data-course') || 'Classic Bar';
            
            if (inlineCourseSelect) {
                inlineCourseSelect.value = course;
            }
            if (inlinePriceDisplay) {
                inlinePriceDisplay.textContent = COURSE_PRICE_MAP[course] || '15,000 DZD';
            }

            // If success card was showing, restore the form
            if (inlineForm) inlineForm.style.display = 'flex';
            if (inlineSuccessCard) inlineSuccessCard.style.display = 'none';

            // Smooth scroll to the form
            const enrollSection = document.getElementById('enroll-section');
            if (enrollSection) {
                enrollSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }

            // Pulse highlight effect on the card
            if (enrollFormCard) {
                enrollFormCard.classList.add('pulse-highlight');
                setTimeout(() => enrollFormCard.classList.remove('pulse-highlight'), 1200);
            }

            // Focus name field
            setTimeout(() => {
                if (inlineStudentName) inlineStudentName.focus();
            }, 400);
        });
    });

    // Clear errors on typing
    if (inlineStudentName) {
        inlineStudentName.addEventListener('input', () => {
            if (inlineNameError) inlineNameError.style.display = 'none';
            inlineStudentName.classList.remove('input-error');
        });
    }
    if (inlineStudentPhone) {
        inlineStudentPhone.addEventListener('input', () => {
            if (inlinePhoneError) inlinePhoneError.style.display = 'none';
            inlineStudentPhone.classList.remove('input-error');
        });
    }

    // Core Submit Action
    async function handleOrderSubmission() {
        const name = (inlineStudentName ? inlineStudentName.value : '').trim();
        const phone = (inlineStudentPhone ? inlineStudentPhone.value : '').trim();
        const course = inlineCourseSelect ? inlineCourseSelect.value : 'Classic Bar';
        const price = COURSE_PRICE_MAP[course] || '15,000 DZD';

        let hasError = false;

        // Name check: simple & flexible (non-empty)
        if (!name) {
            if (inlineNameError) inlineNameError.style.display = 'block';
            if (inlineStudentName) inlineStudentName.classList.add('input-error');
            if (inlineStudentName) inlineStudentName.focus();
            hasError = true;
        } else {
            if (inlineNameError) inlineNameError.style.display = 'none';
            if (inlineStudentName) inlineStudentName.classList.remove('input-error');
        }

        // Phone check: non-empty (at least 3 characters)
        if (!phone || phone.length < 3) {
            if (inlinePhoneError) inlinePhoneError.style.display = 'block';
            if (inlineStudentPhone) inlineStudentPhone.classList.add('input-error');
            if (!hasError && inlineStudentPhone) inlineStudentPhone.focus();
            hasError = true;
        } else {
            if (inlinePhoneError) inlinePhoneError.style.display = 'none';
            if (inlineStudentPhone) inlineStudentPhone.classList.remove('input-error');
        }

        if (hasError) return;

        // Generate Order ID
        const orderId = '#JB-' + Math.floor(1000 + Math.random() * 9000);

        // Build Order
        const newOrder = {
            id: orderId,
            name: name,
            phone: phone,
            course: course,
            price: price,
            status: 'Pending',
            timestamp: new Date().toISOString()
        };

        // Save order to Firebase
        if (window.fb) {
            const btn = inlineSubmitBtn || document.querySelector('button[type="submit"]');
            const originalText = btn ? btn.textContent : '';
            if (btn) btn.textContent = 'Submitting...';
            
            try {
                await window.fb.addDoc(window.fb.collection(window.fb.db, "orders"), newOrder);
            } catch (e) {
                console.error("Error adding order: ", e);
                alert("Failed to submit order. Please try again.");
                if (btn) btn.textContent = originalText;
                return;
            }
            if (btn) btn.textContent = originalText;
        } else {
            // Fallback to local storage if firebase not loaded yet
            const orders = getOrders();
            orders.unshift(newOrder);
            saveOrders(orders);
            updateNavBadge();
        }

        // Update Success Ticket
        const tId = document.getElementById('ticket-order-id');
        const tName = document.getElementById('ticket-student-name');
        const tPhone = document.getElementById('ticket-student-phone');
        const tCourse = document.getElementById('ticket-course-name');
        const tPrice = document.getElementById('ticket-price-name');

        if (tId) tId.textContent = orderId;
        if (tName) tName.textContent = name;
        if (tPhone) tPhone.textContent = phone;
        if (tCourse) tCourse.textContent = course;
        if (tPrice) tPrice.textContent = price;

        // Switch to success card
        if (inlineForm) inlineForm.style.display = 'none';
        if (inlineSuccessCard) inlineSuccessCard.style.display = 'flex';

        // Re-render admin panel if unlocked
        renderAdminPanel();
    }

    // Attach submit listeners to both button and form
    if (inlineSubmitBtn) {
        inlineSubmitBtn.addEventListener('click', (e) => {
            e.preventDefault();
            handleOrderSubmission();
        });
    }

    if (inlineForm) {
        inlineForm.addEventListener('submit', (e) => {
            e.preventDefault();
            handleOrderSubmission();
        });
    }

    // "Register Another Student"
    if (btnOrderAnother) {
        btnOrderAnother.addEventListener('click', () => {
            if (inlineForm) {
                inlineForm.reset();
                inlineForm.style.display = 'flex';
            }
            if (inlineSuccessCard) inlineSuccessCard.style.display = 'none';
            if (inlineStudentName) inlineStudentName.focus();
        });
    }

    // ---------------------------------------------------------------------
    // 4. PASSWORD-PROTECTED ADMIN MODAL POPUP (SMALL FOOTER BUTTON ACCESS)
    // ---------------------------------------------------------------------
    const btnOpenAdminAuth = document.getElementById('btn-open-admin-auth');
    const adminModalBackdrop = document.getElementById('admin-modal-backdrop');
    const btnCloseAdminModal = document.getElementById('btn-close-admin-modal');
    const adminModalLockView = document.getElementById('admin-modal-lock-view');
    const adminModalDashboardView = document.getElementById('admin-modal-dashboard-view');

    const adminAuthForm = document.getElementById('admin-auth-form');
    const adminPassField = document.getElementById('admin-pass-field');
    const adminAuthError = document.getElementById('admin-auth-error');
    const btnToggleEye = document.getElementById('btn-toggle-eye');
    const btnSubmitPassword = document.getElementById('btn-submit-password');
    const btnLockModal = document.getElementById('btn-lock-modal');
    const btnPanelAddTest = document.getElementById('btn-panel-add-test');

    const panelOrdersContainer = document.getElementById('panel-orders-container');
    const panelOrdersEmpty = document.getElementById('panel-orders-empty');
    const panelSearchQuery = document.getElementById('panel-search-query');
    const panelFilterCourse = document.getElementById('panel-filter-course');
    const panelFilterStatus = document.getElementById('panel-filter-status');

    // Show the modal dialog
    function openAdminModal() {
        if (!adminModalBackdrop) return;
        adminModalBackdrop.style.display = 'flex';
        document.body.style.overflow = 'hidden'; // prevent bg scroll when modal is open

        const isUnlocked = sessionStorage.getItem('jb_admin_unlocked') === 'true';
        if (isUnlocked) {
            showDashboardInModal();
        } else {
            showLockInModal();
        }
    }

    // Hide the modal dialog
    function closeAdminModal() {
        if (!adminModalBackdrop) return;
        adminModalBackdrop.style.display = 'none';
        document.body.style.overflow = '';
    }

    function showLockInModal() {
        if (adminModalLockView) adminModalLockView.style.display = 'flex';
        if (adminModalDashboardView) adminModalDashboardView.style.display = 'none';
        if (adminPassField) {
            adminPassField.value = '';
            setTimeout(() => adminPassField.focus(), 150);
        }
        if (adminAuthError) adminAuthError.style.display = 'none';
    }

    function showDashboardInModal() {
        if (adminModalLockView) adminModalLockView.style.display = 'none';
        if (adminModalDashboardView) adminModalDashboardView.style.display = 'flex';
        sessionStorage.setItem('jb_admin_unlocked', 'true');
        renderAdminPanel();
    }

    function lockModalDashboard() {
        sessionStorage.removeItem('jb_admin_unlocked');
        showLockInModal();
    }

    // Password verification (yacine123)
    function verifyAdminPassword() {
        const entered = (adminPassField ? adminPassField.value : '').trim();
        if (entered === ADMIN_PASSWORD) {
            if (adminAuthError) adminAuthError.style.display = 'none';
            showDashboardInModal();
        } else {
            if (adminAuthError) adminAuthError.style.display = 'flex';
            if (adminPassField) {
                adminPassField.classList.add('shake-error');
                setTimeout(() => adminPassField.classList.remove('shake-error'), 500);
                adminPassField.focus();
                adminPassField.select();
            }
        }
    }

    // Wire Open & Close
    if (btnOpenAdminAuth) {
        btnOpenAdminAuth.addEventListener('click', (e) => {
            e.preventDefault();
            openAdminModal();
        });
    }

    if (btnCloseAdminModal) {
        btnCloseAdminModal.addEventListener('click', closeAdminModal);
    }

    if (adminModalBackdrop) {
        adminModalBackdrop.addEventListener('click', (e) => {
            if (e.target === adminModalBackdrop) {
                closeAdminModal();
            }
        });
    }

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && adminModalBackdrop && adminModalBackdrop.style.display !== 'none') {
            closeAdminModal();
        }
    });

    // Form submit & submit button
    if (adminAuthForm) {
        adminAuthForm.addEventListener('submit', (e) => {
            e.preventDefault();
            verifyAdminPassword();
        });
    }

    if (btnSubmitPassword) {
        btnSubmitPassword.addEventListener('click', (e) => {
            e.preventDefault();
            verifyAdminPassword();
        });
    }

    if (adminPassField) {
        adminPassField.addEventListener('input', () => {
            if (adminAuthError) adminAuthError.style.display = 'none';
        });
    }

    // Password visibility eye toggle
    if (btnToggleEye && adminPassField) {
        btnToggleEye.addEventListener('click', () => {
            const isPassword = adminPassField.type === 'password';
            adminPassField.type = isPassword ? 'text' : 'password';
            btnToggleEye.innerHTML = isPassword ? '<i class="fas fa-eye-slash"></i>' : '<i class="fas fa-eye"></i>';
        });
    }

    // Lock button inside dashboard view
    if (btnLockModal) {
        btnLockModal.addEventListener('click', lockModalDashboard);
    }

    // Add Test Order button
    if (btnPanelAddTest) {
        btnPanelAddTest.addEventListener('click', () => {
            const names = ['Karim Boukhalfa', 'Amine Zerrouki', 'Sarah Mansouri', 'Yacine Haddad'];
            const phones = ['0550 12 34 56', '0661 98 76 54', '0770 11 22 33', '0541 44 55 66'];
            const courses = [
                { name: 'Classic Bar', price: '15,000 DZD' },
                { name: 'Extra Barman', price: '20,000 DZD' }
            ];
            const randCourse = courses[Math.floor(Math.random() * courses.length)];
            const newTest = {
                id: '#JB-' + Math.floor(1000 + Math.random() * 9000),
                name: names[Math.floor(Math.random() * names.length)],
                phone: phones[Math.floor(Math.random() * phones.length)],
                course: randCourse.name,
                price: randCourse.price,
                status: 'Pending',
                timestamp: new Date().toISOString()
            };

            const orders = getOrders();
            orders.unshift(newTest);
            saveOrders(orders);
            updateNavBadge();
            renderAdminPanel();
        });
    }

    // Search and filter inputs
    if (panelSearchQuery) panelSearchQuery.addEventListener('input', renderAdminPanel);
    if (panelFilterCourse) panelFilterCourse.addEventListener('change', renderAdminPanel);
    if (panelFilterStatus) panelFilterStatus.addEventListener('change', renderAdminPanel);

    // Render Admin Panel Function
    function renderAdminPanel() {
        if (!panelOrdersContainer) return;

        const orders = getOrders();
        const query = (panelSearchQuery ? panelSearchQuery.value : '').trim().toLowerCase();
        const selCourse = panelFilterCourse ? panelFilterCourse.value : 'ALL';
        const selStatus = panelFilterStatus ? panelFilterStatus.value : 'ALL';

        // Calculate KPIs
        let pending = 0;
        let confirmed = 0;
        let revenue = 0;

        orders.forEach(o => {
            if (o.status === 'Pending') pending++;
            if (o.status === 'Confirmed' || o.status === 'Completed') confirmed++;
            const num = parseInt(String(o.price || '0').replace(/\D/g, ''), 10);
            if (!isNaN(num)) revenue += num;
        });

        const elTotal = document.getElementById('kpi-total-orders');
        const elPending = document.getElementById('kpi-pending-orders');
        const elConfirmed = document.getElementById('kpi-confirmed-orders');
        const elRev = document.getElementById('kpi-revenue-orders');
        const elTabCount = document.getElementById('tab-orders-count');

        if (elTotal) elTotal.textContent = orders.length;
        if (elTabCount) elTabCount.textContent = orders.length;
        if (elPending) elPending.textContent = pending;
        if (elConfirmed) elConfirmed.textContent = confirmed;
        if (elRev) elRev.textContent = revenue.toLocaleString() + ' DZD';

        // Filter Orders
        const filtered = orders.filter(o => {
            const matchesQuery = (o.name || '').toLowerCase().includes(query) ||
                                 (o.phone || '').toLowerCase().includes(query) ||
                                 (o.id || '').toLowerCase().includes(query);
            const matchesCourse = selCourse === 'ALL' || o.course === selCourse;
            const matchesStatus = selStatus === 'ALL' || o.status === selStatus;
            return matchesQuery && matchesCourse && matchesStatus;
        });

        if (orders.length === 0) {
            panelOrdersContainer.innerHTML = '';
            if (panelOrdersEmpty) panelOrdersEmpty.style.display = 'flex';
            return;
        } else {
            if (panelOrdersEmpty) panelOrdersEmpty.style.display = 'none';
        }

        if (filtered.length === 0) {
            panelOrdersContainer.innerHTML = `
                <div class="panel-no-results">
                    <i class="fas fa-search"></i>
                    <p>No student orders match the search filter.</p>
                </div>
            `;
            return;
        }

        panelOrdersContainer.innerHTML = filtered.map(order => {
            const waUrl = getWhatsAppUrl(order.phone, order.name, order.course);
            const telUrl = `tel:${(order.phone || '').replace(/\s+/g, '')}`;
            const statusClass = (order.status || 'Pending').toLowerCase();
            const courseIcon = order.course === 'Classic Bar'
                ? '<i class="fas fa-cocktail icon-bronze"></i>'
                : (order.course === 'Extra Barman'
                    ? '<i class="fas fa-wine-glass-alt icon-silver"></i>'
                    : '<i class="fas fa-crown icon-gold"></i>');

            return `
                <div class="panel-order-card" data-order-id="${order.id}">
                    <div class="order-card-header">
                        <span class="order-card-ref">${order.id || '#JB-0000'}</span>
                        <span class="order-card-time"><i class="far fa-clock"></i> ${formatDate(order.timestamp)}</span>
                    </div>

                    <div class="order-card-body">
                        <div class="order-student-info">
                            <h4 class="order-student-name"><i class="fas fa-user-circle icon-blue"></i> ${escapeHtml(order.name || 'Anonymous')}</h4>
                            <div class="order-student-phone"><i class="fas fa-phone-alt icon-green"></i> ${escapeHtml(order.phone || '--')}</div>
                        </div>

                        <div class="order-course-tag">
                            <span class="badge-course">${courseIcon} ${escapeHtml(order.course || 'Course')}</span>
                            <strong class="badge-price">${escapeHtml(order.price || '--')}</strong>
                        </div>
                    </div>

                    <div class="order-card-footer">
                        <div class="order-status-wrap">
                            <select class="status-select status-${statusClass}" onchange="updateOrderStatus('${order.id}', this.value)">
                                <option value="Pending" ${order.status === 'Pending' ? 'selected' : ''}>⏳ Pending</option>
                                <option value="Confirmed" ${order.status === 'Confirmed' ? 'selected' : ''}>✅ Confirmed</option>
                                <option value="Completed" ${order.status === 'Completed' ? 'selected' : ''}>🎓 Completed</option>
                                <option value="Cancelled" ${order.status === 'Cancelled' ? 'selected' : ''}>❌ Cancelled</option>
                            </select>
                        </div>

                        <div class="order-action-buttons">
                            <a href="${waUrl}" target="_blank" rel="noopener noreferrer" class="btn-action btn-action-wa" title="WhatsApp Student">
                                <i class="fab fa-whatsapp"></i> WhatsApp
                            </a>
                            <a href="${telUrl}" class="btn-action btn-action-call" title="Call Student">
                                <i class="fas fa-phone"></i> Call
                            </a>
                            <button type="button" onclick="deleteOrderById('${order.id}')" class="btn-action btn-action-del" title="Delete Order">
                                <i class="fas fa-trash"></i>
                            </button>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    }

    // ---------------------------------------------------------------------
    // 5. ADMIN TABS & LIVE MEDIA & CONTENT MANAGER
    // ---------------------------------------------------------------------
    const tabBtnOrders = document.getElementById('tab-btn-orders');
    const tabBtnGallery = document.getElementById('tab-btn-gallery');
    const tabBtnMedia = document.getElementById('tab-btn-media');
    const tabPaneOrders = document.getElementById('admin-tab-orders');
    const tabPaneGallery = document.getElementById('admin-tab-gallery');
    const tabPaneMedia = document.getElementById('admin-tab-media');

    const allTabBtns = [tabBtnOrders, tabBtnGallery, tabBtnMedia];
    const allTabPanes = [tabPaneOrders, tabPaneGallery, tabPaneMedia];

    function switchAdminTab(targetTab) {
        allTabBtns.forEach(b => { if (b) b.classList.remove('active'); });
        allTabPanes.forEach(p => { if (p) p.style.display = 'none'; });

        if (targetTab === 'orders') {
            if (tabBtnOrders) tabBtnOrders.classList.add('active');
            if (tabPaneOrders) tabPaneOrders.style.display = 'block';
        } else if (targetTab === 'gallery') {
            if (tabBtnGallery) tabBtnGallery.classList.add('active');
            if (tabPaneGallery) tabPaneGallery.style.display = 'flex';
            renderAllAdminGalleries();
        } else {
            if (tabBtnMedia) tabBtnMedia.classList.add('active');
            if (tabPaneMedia) tabPaneMedia.style.display = 'flex';

            // Sync current media into inputs and preview boxes
            const currentMedia = getSiteMedia();
            const inputTopVideo = document.getElementById('media-top-video-url');
            const inputC1 = document.getElementById('media-c1-url');
            const inputC2 = document.getElementById('media-c2-url');
            const prevC1 = document.getElementById('preview-c1-img');
            const prevC2 = document.getElementById('preview-c2-img');

            if (inputTopVideo) inputTopVideo.value = currentMedia.topVideo.startsWith('data:') ? '' : currentMedia.topVideo;
            if (inputC1) inputC1.value = currentMedia.course1Img.startsWith('data:') ? '' : currentMedia.course1Img;
            if (inputC2) inputC2.value = currentMedia.course2Img.startsWith('data:') ? '' : currentMedia.course2Img;
            if (prevC1 && currentMedia.course1Img) prevC1.src = currentMedia.course1Img;
            if (prevC2 && currentMedia.course2Img) prevC2.src = currentMedia.course2Img;
        }
    }

    if (tabBtnOrders) tabBtnOrders.addEventListener('click', () => switchAdminTab('orders'));
    if (tabBtnGallery) tabBtnGallery.addEventListener('click', () => switchAdminTab('gallery'));
    if (tabBtnMedia) tabBtnMedia.addEventListener('click', () => switchAdminTab('media'));

    // File inputs & URL listeners
    const mediaTopVideoFile = document.getElementById('media-top-video-file');
    const fileNameVideo = document.getElementById('file-name-video');
    const mediaTopVideoUrl = document.getElementById('media-top-video-url');

    const mediaC1File = document.getElementById('media-c1-file');
    const mediaC1Url = document.getElementById('media-c1-url');
    const previewC1Img = document.getElementById('preview-c1-img');

    const mediaC2File = document.getElementById('media-c2-file');
    const mediaC2Url = document.getElementById('media-c2-url');
    const previewC2Img = document.getElementById('preview-c2-img');

    const btnSaveMedia = document.getElementById('btn-save-media');
    const btnResetMedia = document.getElementById('btn-reset-media');
    const mediaSaveToast = document.getElementById('media-save-toast');

    let selectedVideoFile = null;
    let selectedC1File = null;
    let selectedC2File = null;

    // Handle Top Video file upload
    if (mediaTopVideoFile) {
        mediaTopVideoFile.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;
            selectedVideoFile = file;
            const sizeMb = (file.size / (1024 * 1024)).toFixed(1);
            if (fileNameVideo) {
                fileNameVideo.textContent = `✓ Selected: ${file.name} (${sizeMb} MB) — ready to save`;
                fileNameVideo.style.color = '#39ff14';
            }
        });
    }

    // Handle Course 1 image upload (instant preview)
    if (mediaC1File) {
        mediaC1File.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;
            selectedC1File = file;
            const previewUrl = URL.createObjectURL(file);
            if (previewC1Img) previewC1Img.src = previewUrl;
        });
    }

    // Handle Course 2 image upload (instant preview)
    if (mediaC2File) {
        mediaC2File.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;
            selectedC2File = file;
            const previewUrl = URL.createObjectURL(file);
            if (previewC2Img) previewC2Img.src = previewUrl;
        });
    }

    // Live URL preview on typing
    if (mediaC1Url) {
        mediaC1Url.addEventListener('input', () => {
            const url = mediaC1Url.value.trim();
            if (url && previewC1Img) previewC1Img.src = url;
        });
    }
    if (mediaC2Url) {
        mediaC2Url.addEventListener('input', () => {
            const url = mediaC2Url.value.trim();
            if (url && previewC2Img) previewC2Img.src = url;
        });
    }

    const btnClearVideo = document.getElementById('btn-clear-video');
    const btnClearC1 = document.getElementById('btn-clear-c1');
    const btnClearC2 = document.getElementById('btn-clear-c2');

    // Remove / Reset Top Video
    if (btnClearVideo) {
        btnClearVideo.addEventListener('click', async () => {
            if (!confirm('Delete custom video and restore academy default?')) return;
            selectedVideoFile = null;
            if (mediaTopVideoFile) mediaTopVideoFile.value = '';
            if (fileNameVideo) fileNameVideo.textContent = '';
            if (mediaTopVideoUrl) mediaTopVideoUrl.value = DEFAULT_MEDIA.topVideo;

            if (currentSiteMedia.topVideo) {
                if (currentSiteMedia.topVideo.includes('firebasestorage.googleapis.com') && window.fb) {
                    try {
                        const storageRef = window.fb.ref(window.fb.storage, currentSiteMedia.topVideo);
                        window.fb.deleteObject(storageRef).catch(e => console.log('Could not delete video', e));
                    } catch(e) {}
                } else if (currentSiteMedia.topVideo.startsWith('assets/uploads/')) {
                    fetch('/api/delete-file', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ path: currentSiteMedia.topVideo })
                    }).catch(() => {});
                }
            }

            await idbDelete('mediaStore', 'video_blob');
            currentSiteMedia.topVideo = DEFAULT_MEDIA.topVideo;
            await applySiteMedia();

            try {
                if (window.fb) {
                    await window.fb.setDoc(window.fb.doc(window.fb.db, "settings", "media"), currentSiteMedia, { merge: true });
                }
                await idbSet('mediaStore', 'active_media', currentSiteMedia);
                localStorage.setItem(MEDIA_STORAGE_KEY, JSON.stringify(currentSiteMedia));
            } catch (e) {}

            if (mediaSaveToast) {
                mediaSaveToast.className = 'whatsapp-alert success';
                mediaSaveToast.innerHTML = '<i class="fas fa-trash-alt"></i> Custom video removed. Academy default restored.';
                mediaSaveToast.style.display = 'flex';
                setTimeout(() => mediaSaveToast.style.display = 'none', 3000);
            }
        });
    }

    // Remove / Reset Course 1 Image
    if (btnClearC1) {
        btnClearC1.addEventListener('click', async () => {
            if (!confirm('Delete custom Course 1 photo and restore academy default?')) return;
            selectedC1File = null;
            if (mediaC1File) mediaC1File.value = '';
            if (mediaC1Url) mediaC1Url.value = DEFAULT_MEDIA.course1Img;
            if (previewC1Img) previewC1Img.src = DEFAULT_MEDIA.course1Img;

            if (currentSiteMedia.course1Img) {
                if (currentSiteMedia.course1Img.includes('firebasestorage.googleapis.com') && window.fb) {
                    try {
                        const storageRef = window.fb.ref(window.fb.storage, currentSiteMedia.course1Img);
                        window.fb.deleteObject(storageRef).catch(e => console.log('Could not delete img', e));
                    } catch(e) {}
                } else if (currentSiteMedia.course1Img.startsWith('assets/uploads/')) {
                    fetch('/api/delete-file', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ path: currentSiteMedia.course1Img })
                    }).catch(() => {});
                }
            }

            await idbDelete('mediaStore', 'c1_blob');
            currentSiteMedia.course1Img = DEFAULT_MEDIA.course1Img;
            await applySiteMedia();

            try {
                if (window.fb) {
                    await window.fb.setDoc(window.fb.doc(window.fb.db, "settings", "media"), currentSiteMedia, { merge: true });
                }
                await idbSet('mediaStore', 'active_media', currentSiteMedia);
                localStorage.setItem(MEDIA_STORAGE_KEY, JSON.stringify(currentSiteMedia));
            } catch (e) {}

            if (mediaSaveToast) {
                mediaSaveToast.className = 'whatsapp-alert success';
                mediaSaveToast.innerHTML = '<i class="fas fa-trash-alt"></i> Custom photo removed. Academy default restored.';
                mediaSaveToast.style.display = 'flex';
                setTimeout(() => mediaSaveToast.style.display = 'none', 3000);
            }
        });
    }

    // Remove / Reset Course 2 Image
    if (btnClearC2) {
        btnClearC2.addEventListener('click', async () => {
            if (!confirm('Delete custom Course 2 photo and restore academy default?')) return;
            selectedC2File = null;
            if (mediaC2File) mediaC2File.value = '';
            if (mediaC2Url) mediaC2Url.value = DEFAULT_MEDIA.course2Img;
            if (previewC2Img) previewC2Img.src = DEFAULT_MEDIA.course2Img;

            if (currentSiteMedia.course2Img) {
                if (currentSiteMedia.course2Img.includes('firebasestorage.googleapis.com') && window.fb) {
                    try {
                        const storageRef = window.fb.ref(window.fb.storage, currentSiteMedia.course2Img);
                        window.fb.deleteObject(storageRef).catch(e => console.log('Could not delete img', e));
                    } catch(e) {}
                } else if (currentSiteMedia.course2Img.startsWith('assets/uploads/')) {
                    fetch('/api/delete-file', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ path: currentSiteMedia.course2Img })
                    }).catch(() => {});
                }
            }

            await idbDelete('mediaStore', 'c2_blob');
            currentSiteMedia.course2Img = DEFAULT_MEDIA.course2Img;
            await applySiteMedia();

            try {
                if (window.fb) {
                    await window.fb.setDoc(window.fb.doc(window.fb.db, "settings", "media"), currentSiteMedia, { merge: true });
                }
                await idbSet('mediaStore', 'active_media', currentSiteMedia);
                localStorage.setItem(MEDIA_STORAGE_KEY, JSON.stringify(currentSiteMedia));
            } catch (e) {}

            if (mediaSaveToast) {
                mediaSaveToast.className = 'whatsapp-alert success';
                mediaSaveToast.innerHTML = '<i class="fas fa-trash-alt"></i> Custom photo removed. Academy default restored.';
                mediaSaveToast.style.display = 'flex';
                setTimeout(() => mediaSaveToast.style.display = 'none', 3000);
            }
        });
    }

    // Save Media button (Uploads directly to Server Disk / IndexedDB, no 5MB limit!)
    if (btnSaveMedia) {
        btnSaveMedia.addEventListener('click', async () => {
            const origHtml = btnSaveMedia.innerHTML;
            btnSaveMedia.disabled = true;
            btnSaveMedia.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving & Uploading...';

            if (mediaSaveToast) {
                mediaSaveToast.style.display = 'flex';
                mediaSaveToast.className = 'whatsapp-alert info';
                mediaSaveToast.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Uploading media files and saving to database...';
            }

            try {
                let newTopVideo = (mediaTopVideoUrl && mediaTopVideoUrl.value.trim()) || currentSiteMedia.topVideo;
                let newC1 = (mediaC1Url && mediaC1Url.value.trim()) || currentSiteMedia.course1Img;
                let newC2 = (mediaC2Url && mediaC2Url.value.trim()) || currentSiteMedia.course2Img;

                // 1. Process and upload Video File
                if (selectedVideoFile) {
                    if (window.fb) {
                        const storageRef = window.fb.ref(window.fb.storage, `media/${Date.now()}_${selectedVideoFile.name}`);
                        const uploadResult = await window.fb.uploadBytes(storageRef, selectedVideoFile);
                        newTopVideo = await window.fb.getDownloadURL(uploadResult.ref);
                    } else {
                        // IndexedDB fallback
                        await idbSet('mediaStore', 'video_blob', selectedVideoFile);
                        newTopVideo = 'idb:video_blob';
                    }
                }

                // 2. Process and upload Course 1 image
                if (selectedC1File) {
                    const compressed = await compressImageFile(selectedC1File);
                    if (window.fb) {
                        const storageRef = window.fb.ref(window.fb.storage, `media/${Date.now()}_${compressed.name}`);
                        const uploadResult = await window.fb.uploadBytes(storageRef, compressed);
                        newC1 = await window.fb.getDownloadURL(uploadResult.ref);
                    } else {
                        await idbSet('mediaStore', 'c1_blob', compressed);
                        newC1 = 'idb:c1_blob';
                    }
                }

                // 3. Process and upload Course 2 image
                if (selectedC2File) {
                    const compressed = await compressImageFile(selectedC2File);
                    if (window.fb) {
                        const storageRef = window.fb.ref(window.fb.storage, `media/${Date.now()}_${compressed.name}`);
                        const uploadResult = await window.fb.uploadBytes(storageRef, compressed);
                        newC2 = await window.fb.getDownloadURL(uploadResult.ref);
                    } else {
                        await idbSet('mediaStore', 'c2_blob', compressed);
                        newC2 = 'idb:c2_blob';
                    }
                }

                const updated = {
                    topVideo: newTopVideo,
                    course1Img: newC1,
                    course2Img: newC2,
                    updatedAt: new Date().toISOString()
                };

                currentSiteMedia = updated;

                // Persist to Firebase Firestore
                if (window.fb) {
                    await window.fb.setDoc(window.fb.doc(window.fb.db, "settings", "media"), updated, { merge: true });
                }

                // Persist to IndexedDB
                await idbSet('mediaStore', 'active_media', updated);

                // Persist to localStorage safely
                try {
                    localStorage.setItem(MEDIA_STORAGE_KEY, JSON.stringify(updated));
                } catch (e) {
                    console.warn('localStorage save failed', e);
                }

                // Clear selected files
                selectedVideoFile = null;
                selectedC1File = null;
                selectedC2File = null;
                if (mediaTopVideoFile) mediaTopVideoFile.value = '';
                if (mediaC1File) mediaC1File.value = '';
                if (mediaC2File) mediaC2File.value = '';
                if (fileNameVideo) fileNameVideo.textContent = '';

                // Apply to live site
                await applySiteMedia();

                if (mediaSaveToast) {
                    mediaSaveToast.className = 'whatsapp-alert success';
                    mediaSaveToast.innerHTML = '<i class="fas fa-check-circle"></i> Media saved and stored successfully! Live website refreshed.';
                    setTimeout(() => {
                        mediaSaveToast.style.display = 'none';
                    }, 4000);
                }
            } catch (err) {
                console.error('Save media error', err);
                if (mediaSaveToast) {
                    mediaSaveToast.className = 'whatsapp-alert error';
                    mediaSaveToast.innerHTML = '<i class="fas fa-exclamation-triangle"></i> Failed to save media: ' + (err.message || 'Unknown error');
                }
            } finally {
                btnSaveMedia.disabled = false;
                btnSaveMedia.innerHTML = origHtml;
            }
        });
    }

    // Reset Media button
    if (btnResetMedia) {
        btnResetMedia.addEventListener('click', async () => {
            if (!confirm('Reset top video and course images back to original academy defaults?')) return;
            currentSiteMedia = { ...DEFAULT_MEDIA };

            // Post to Firebase
            try {
                if (window.fb) {
                    await window.fb.setDoc(window.fb.doc(window.fb.db, "settings", "media"), DEFAULT_MEDIA, { merge: true });
                }
            } catch (e) {}

            // Clear IndexedDB
            await idbSet('mediaStore', 'active_media', DEFAULT_MEDIA);
            await idbDelete('mediaStore', 'video_blob');
            await idbDelete('mediaStore', 'c1_blob');
            await idbDelete('mediaStore', 'c2_blob');

            // Clear localStorage
            try {
                localStorage.setItem(MEDIA_STORAGE_KEY, JSON.stringify(DEFAULT_MEDIA));
            } catch (e) {}

            selectedVideoFile = null;
            selectedC1File = null;
            selectedC2File = null;
            if (mediaTopVideoFile) mediaTopVideoFile.value = '';
            if (mediaC1File) mediaC1File.value = '';
            if (mediaC2File) mediaC2File.value = '';
            if (fileNameVideo) fileNameVideo.textContent = '';

            if (mediaTopVideoUrl) mediaTopVideoUrl.value = DEFAULT_MEDIA.topVideo;
            if (mediaC1Url) mediaC1Url.value = DEFAULT_MEDIA.course1Img;
            if (mediaC2Url) mediaC2Url.value = DEFAULT_MEDIA.course2Img;

            await applySiteMedia();

            if (mediaSaveToast) {
                mediaSaveToast.className = 'whatsapp-alert success';
                mediaSaveToast.innerHTML = '<i class="fas fa-undo"></i> Media reset to original defaults.';
                mediaSaveToast.style.display = 'flex';
                setTimeout(() => {
                    mediaSaveToast.style.display = 'none';
                }, 3000);
            }
        });
    }

    // Global Action: Update Order Status
    window.updateOrderStatus = async function(orderId, newStatus) {
        const orders = getOrders();
        const order = orders.find(o => o.id === orderId);
        if (order && order.firebaseId && window.fb) {
            const docRef = window.fb.doc(window.fb.db, "orders", order.firebaseId);
            await window.fb.setDoc(docRef, { status: newStatus }, { merge: true });
            // UI updates automatically via onSnapshot
        }
    };

    // Global Action: Delete Order
    window.deleteOrderById = async function(orderId) {
        if (!confirm(`Delete order ${orderId}?`)) return;
        const orders = getOrders();
        const order = orders.find(o => o.id === orderId);
        if (order && order.firebaseId && window.fb) {
            const docRef = window.fb.doc(window.fb.db, "orders", order.firebaseId);
            await window.fb.deleteDoc(docRef);
            // UI updates automatically via onSnapshot
        }
    };

    // Escape HTML to prevent XSS
    function escapeHtml(str) {
        const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
        return String(str).replace(/[&<>"']/g, m => map[m]);
    }

    // Initial badge, media, and orders sync from database
    // =====================================================================
    // 6. GALLERY ADMIN UPLOAD HANDLERS
    // =====================================================================
    const galleryUploadClassic = document.getElementById('gallery-upload-classic');
    const galleryUploadExtra = document.getElementById('gallery-upload-extra');
    const gallerySaveToast = document.getElementById('gallery-save-toast');

    function showGalleryToast(msg, type) {
        if (!gallerySaveToast) return;
        gallerySaveToast.className = `whatsapp-alert ${type || 'success'}`;
        gallerySaveToast.innerHTML = `<i class="fas fa-${type === 'error' ? 'exclamation-triangle' : 'check-circle'}"></i> ${msg}`;
        gallerySaveToast.style.display = 'flex';
        setTimeout(() => { gallerySaveToast.style.display = 'none'; }, 3500);
    }

    async function handleGalleryUpload(courseKey, files) {
        const current = galleryData[courseKey] || [];
        const maxAllowed = 20 - current.length;
        if (maxAllowed <= 0) {
            showGalleryToast('Maximum 20 photos reached for this course. Delete some to add new ones.', 'error');
            return;
        }

        const filesToProcess = Array.from(files).slice(0, maxAllowed);
        const newUrls = [];

        for (const file of filesToProcess) {
            const compressed = await compressImageFile(file, 1200, 1200, 0.82);
            let uploadedUrl = null;
            try {
                if (window.fb) {
                    const storageRef = window.fb.ref(window.fb.storage, `gallery/${courseKey}/${Date.now()}_${compressed.name}`);
                    const uploadResult = await window.fb.uploadBytes(storageRef, compressed);
                    uploadedUrl = await window.fb.getDownloadURL(uploadResult.ref);
                } else {
                    const formData = new FormData();
                    formData.append('file', compressed, compressed.name);
                    const res = await fetch('/api/upload', { method: 'POST', body: formData });
                    if (res.ok) {
                        const json = await res.json();
                        if (json && json.url) uploadedUrl = json.url;
                    }
                }
            } catch (e) {
                console.error("Upload failed", e);
            }

            if (uploadedUrl) {
                newUrls.push(uploadedUrl);
            } else {
                // Fallback: store as data URL
                try {
                    const dataUrl = await new Promise((resolve) => {
                        const reader = new FileReader();
                        reader.onload = () => resolve(reader.result);
                        reader.onerror = () => resolve(null);
                        reader.readAsDataURL(compressed);
                    });
                    if (dataUrl) newUrls.push(dataUrl);
                } catch (e) {}
            }
        }

        if (newUrls.length > 0) {
            galleryData[courseKey] = [...current, ...newUrls];
            saveGalleryData(galleryData);
            renderAllPublicGalleries();
            renderAllAdminGalleries();
            showGalleryToast(`${newUrls.length} photo(s) uploaded successfully!`);
        }
    }

    if (galleryUploadClassic) {
        galleryUploadClassic.addEventListener('change', async (e) => {
            if (e.target.files.length > 0) {
                await handleGalleryUpload('classicBar', e.target.files);
                galleryUploadClassic.value = '';
            }
        });
    }

    if (galleryUploadExtra) {
        galleryUploadExtra.addEventListener('change', async (e) => {
            if (e.target.files.length > 0) {
                await handleGalleryUpload('extraBarman', e.target.files);
                galleryUploadExtra.value = '';
            }
        });
    }

    // Global: Delete gallery photo
    window.deleteGalleryPhoto = function(courseKey, idx) {
        const photos = galleryData[courseKey] || [];
        if (idx < 0 || idx >= photos.length) return;

        const photoUrl = photos[idx];
        // If server-hosted, delete from disk
        if (photoUrl) {
            if (photoUrl.includes('firebasestorage.googleapis.com') && window.fb) {
                try {
                    const storageRef = window.fb.ref(window.fb.storage, photoUrl);
                    window.fb.deleteObject(storageRef).catch(e => console.log('Could not delete from Firebase Storage', e));
                } catch(e) {}
            } else if (photoUrl.startsWith('assets/uploads/')) {
                fetch('/api/delete-file', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ path: photoUrl })
                }).catch(() => {});
            }
        }

        photos.splice(idx, 1);
        galleryData[courseKey] = photos;
        saveGalleryData(galleryData);
        renderAllPublicGalleries();
        renderAllAdminGalleries();
        showGalleryToast('Photo deleted.');
    };

    // =====================================================================
    // 7. FULLSCREEN LIGHTBOX
    // =====================================================================
    const lightboxOverlay = document.getElementById('gallery-lightbox');
    const lightboxImg = document.getElementById('lightbox-img');
    const lightboxCounter = document.getElementById('lightbox-counter');
    const lightboxCloseBtn = document.getElementById('lightbox-close');
    const lightboxPrevBtn = document.getElementById('lightbox-prev');
    const lightboxNextBtn = document.getElementById('lightbox-next');

    let lightboxPhotos = [];
    let lightboxIndex = 0;

    window.openLightbox = function(courseKey, idx) {
        lightboxPhotos = galleryData[courseKey] || [];
        if (lightboxPhotos.length === 0) return;
        lightboxIndex = idx;
        updateLightbox();
        if (lightboxOverlay) lightboxOverlay.style.display = 'flex';
        document.body.style.overflow = 'hidden';
    };

    function closeLightbox() {
        if (lightboxOverlay) lightboxOverlay.style.display = 'none';
        document.body.style.overflow = '';
    }

    function updateLightbox() {
        if (!lightboxImg || lightboxPhotos.length === 0) return;
        lightboxImg.src = lightboxPhotos[lightboxIndex];
        if (lightboxCounter) lightboxCounter.textContent = `${lightboxIndex + 1} / ${lightboxPhotos.length}`;
    }

    if (lightboxCloseBtn) lightboxCloseBtn.addEventListener('click', closeLightbox);
    if (lightboxOverlay) lightboxOverlay.addEventListener('click', (e) => {
        if (e.target === lightboxOverlay) closeLightbox();
    });

    if (lightboxPrevBtn) lightboxPrevBtn.addEventListener('click', () => {
        if (lightboxPhotos.length === 0) return;
        lightboxIndex = (lightboxIndex - 1 + lightboxPhotos.length) % lightboxPhotos.length;
        updateLightbox();
    });

    if (lightboxNextBtn) lightboxNextBtn.addEventListener('click', () => {
        if (lightboxPhotos.length === 0) return;
        lightboxIndex = (lightboxIndex + 1) % lightboxPhotos.length;
        updateLightbox();
    });

    // Keyboard navigation
    document.addEventListener('keydown', (e) => {
        if (!lightboxOverlay || lightboxOverlay.style.display === 'none') return;
        if (e.key === 'Escape') closeLightbox();
        if (e.key === 'ArrowLeft') {
            lightboxIndex = (lightboxIndex - 1 + lightboxPhotos.length) % lightboxPhotos.length;
            updateLightbox();
        }
        if (e.key === 'ArrowRight') {
            lightboxIndex = (lightboxIndex + 1) % lightboxPhotos.length;
            updateLightbox();
        }
    });

    // Swipe support for mobile lightbox
    let touchStartX = 0;
    if (lightboxOverlay) {
        lightboxOverlay.addEventListener('touchstart', (e) => {
            touchStartX = e.changedTouches[0].screenX;
        }, { passive: true });
        lightboxOverlay.addEventListener('touchend', (e) => {
            const diff = e.changedTouches[0].screenX - touchStartX;
            if (Math.abs(diff) > 50) {
                if (diff > 0) {
                    lightboxIndex = (lightboxIndex - 1 + lightboxPhotos.length) % lightboxPhotos.length;
                } else {
                    lightboxIndex = (lightboxIndex + 1) % lightboxPhotos.length;
                }
                updateLightbox();
            }
        }, { passive: true });
    }

    // Initial badge, media, gallery, and orders sync from database
    updateNavBadge();
    initSiteMedia();
    initGallery();
    syncOrdersFromDatabase();

    window.addEventListener('orders_updated', () => {
        updateNavBadge();
        renderAdminPanel();
    });
    window.addEventListener('media_updated', () => {
        applySiteMedia();
    });
    window.addEventListener('storage', () => {
        updateNavBadge();
        renderAdminPanel();
        applySiteMedia();
        galleryData = getGalleryData();
        renderAllPublicGalleries();
    });
});

