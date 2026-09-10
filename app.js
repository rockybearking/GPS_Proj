/* global kakao */

const PUBLIC_API_KEY = decodeURIComponent('s%2FvWNiKH1YndVRu2mPOq7OXAIj%2Byk0M3JTgvN%2B8UVdSFPq8SBR7zuUdG3mxklTrj6WYIiUidSIUwgE8bz09fzQ%3D%3D');

const defaultLat = 37.5668;
const defaultLng = 126.9786;

// ============================================================================
// 전역 변수 선언부
// ============================================================================
let map = null;
let myLocationOverlay = null;
let currentLatLng = null;
let activeCircle = null;
let activeCircleLabel = null;
let hospitalOverlays = [];
let currentRadiusKm = 10;
let cachedHospitals = [];

// SDK 로드 확인 후 앱 초기화
if (typeof kakao === 'undefined' || !kakao.maps) {
    document.getElementById('status-title').innerText = '❌ 카카오 지도 SDK 오류';
} else {
    kakao.maps.load(function () {
        initMap();
        initBottomSheetEvents();
    });
}

function initMap() {
    const mapContainer = document.getElementById('map');
    const mapOption = {
        center: new kakao.maps.LatLng(defaultLat, defaultLng),
        level: 6,
        draggable: true,
        scroll_wheel: true
    };

    map = new kakao.maps.Map(mapContainer, mapOption);

    window.addEventListener('resize', () => {
        if (map) map.relayout();
    });

    kakao.maps.event.addListener(map, 'zoom_changed', function () {
        const level = map.getLevel();
        if (!activeCircle) return;

        if (currentRadiusKm >= 20 && level <= 4) {
            if (activeCircle.getMap()) activeCircle.setMap(null);
            if (activeCircleLabel && activeCircleLabel.getMap()) activeCircleLabel.setMap(null);
        } else {
            if (!activeCircle.getMap()) activeCircle.setMap(map);
            if (activeCircleLabel && !activeCircleLabel.getMap()) activeCircleLabel.setMap(map);
        }
    });

    const markerContent = document.createElement('div');
    markerContent.className = 'my-location-marker';
    markerContent.innerHTML = '<div class="my-location-pulse"></div><div class="my-location-dot"></div>';

    myLocationOverlay = new kakao.maps.CustomOverlay({
        position: new kakao.maps.LatLng(defaultLat, defaultLng),
        content: markerContent,
        xAnchor: 0.5,
        yAnchor: 0.5,
        zIndex: 10
    });

    // 반경 메뉴 이벤트
    const radiusMainBtn = document.getElementById('radius-main-btn');
    const radiusOptions = document.getElementById('radius-options');

    if (radiusMainBtn && radiusOptions) {
        radiusMainBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            radiusOptions.classList.toggle('open');
        });
    }

    document.querySelectorAll('.radius-btn').forEach(button => {
        button.addEventListener('click', function (e) {
            e.stopPropagation();
            document.querySelectorAll('.radius-btn').forEach(b => b.classList.remove('active'));
            this.classList.add('active');

            currentRadiusKm = parseInt(this.getAttribute('data-radius'), 10);
            if (currentLatLng) {
                renderRadiusAndHospitals(currentLatLng, currentRadiusKm);
            }
            if (radiusOptions) {
                radiusOptions.classList.remove('open');
            }
        });
    });

    document.addEventListener('click', (e) => {
        const wrapper = document.getElementById('radius-menu-wrapper');
        if (wrapper && !wrapper.contains(e.target) && radiusOptions) {
            radiusOptions.classList.remove('open');
        }
    });

    document.getElementById('my-loc-btn').addEventListener('click', () => {
        moveToCurrentLocation(false);
    });

    loadAllEmergencyData().then(() => {
        moveToCurrentLocation(true);
    });
}

function getXmlText(parent, tagName) {
    const nodes = parent.getElementsByTagName(tagName);
    if (nodes && nodes.length > 0 && nodes[0].textContent) {
        return String(nodes[0].textContent).trim();
    }
    return '';
}

/**
 * 3개 API 병렬 조회 (목록 + 가용병상 + 실시간 중증/응급 메시지)
 */
async function loadAllEmergencyData() {
    document.getElementById('status-title').innerText = '⏳ 응급의료기관 데이터 수신 중...';

    try {
        const listUrl = `https://apis.data.go.kr/B552657/ErmctInfoInqireService/getEgytListInfoInqire` +
            `?serviceKey=${encodeURIComponent(PUBLIC_API_KEY)}&pageNo=1&numOfRows=1000`;

        const bedUrl = `https://apis.data.go.kr/B552657/ErmctInfoInqireService/getEmrrmRltmUsefulSckbdInfoInqire` +
            `?serviceKey=${encodeURIComponent(PUBLIC_API_KEY)}&pageNo=1&numOfRows=1000`;

        const msgUrl = `https://apis.data.go.kr/B552657/ErmctInfoInqireService/getEmrrmSrsillDissMsgInqire` +
            `?serviceKey=${encodeURIComponent(PUBLIC_API_KEY)}&pageNo=1&numOfRows=1000`;

        const [listRes, bedRes, msgRes] = await Promise.all([
            fetch(listUrl),
            fetch(bedUrl),
            fetch(msgUrl)
        ]);

        const [listXmlText, bedXmlText, msgXmlText] = await Promise.all([
            listRes.text(),
            bedRes.text(),
            msgRes.text()
        ]);

        const parser = new DOMParser();
        const listDoc = parser.parseFromString(listXmlText, 'application/xml');
        const bedDoc = parser.parseFromString(bedXmlText, 'application/xml');
        const msgDoc = parser.parseFromString(msgXmlText, 'application/xml');

        // 병상 맵
        const bedMap = new Map();
        const bedItems = bedDoc.getElementsByTagName('item');
        for (let i = 0; i < bedItems.length; i++) {
            const item = bedItems[i];
            const hpid = getXmlText(item, 'hpid');
            const hvecStr = getXmlText(item, 'hvec');
            if (hpid) {
                const hvecNum = hvecStr !== '' ? parseInt(hvecStr, 10) : null;
                bedMap.set(hpid, isNaN(hvecNum) ? null : hvecNum);
            }
        }

        // 실시간 특이사항 메시지 맵 (hpid -> 메시지)
        const msgMap = new Map();
        const msgItems = msgDoc.getElementsByTagName('item');
        for (let i = 0; i < msgItems.length; i++) {
            const item = msgItems[i];
            const hpid = getXmlText(item, 'hpid');
            const msg = getXmlText(item, 'symBlkMsg');
            if (hpid && msg) {
                if (msgMap.has(hpid)) {
                    msgMap.set(hpid, msgMap.get(hpid) + '<br>• ' + msg);
                } else {
                    msgMap.set(hpid, '• ' + msg);
                }
            }
        }

        cachedHospitals = [];
        const listItems = listDoc.getElementsByTagName('item');
        for (let i = 0; i < listItems.length; i++) {
            const item = listItems[i];
            const hpid = getXmlText(item, 'hpid');
            const name = getXmlText(item, 'dutyName') || '응급의료기관';
            const tel = getXmlText(item, 'dutyTel1');
            const latStr = getXmlText(item, 'wgs84Lat');
            const lngStr = getXmlText(item, 'wgs84Lon');

            const lat = parseFloat(latStr);
            const lng = parseFloat(lngStr);

            if (!isNaN(lat) && !isNaN(lng)) {
                cachedHospitals.push({
                    hpid,
                    name,
                    tel,
                    lat,
                    lng,
                    hvec: bedMap.has(hpid) ? bedMap.get(hpid) : null,
                    message: msgMap.get(hpid) || null
                });
            }
        }

        document.getElementById('status-title').innerText = '✅ 데이터 준비 완료';
    } catch (err) {
        console.error('데이터 수신 실패:', err);
        document.getElementById('status-title').innerText = '⚠️ 데이터 수신 지연';
    }
}

function moveToCurrentLocation(isInitial) {
    if (!navigator.geolocation) {
        document.getElementById('status-title').innerText = '❌ Geolocation 미지원';
        return;
    }

    navigator.geolocation.getCurrentPosition(
        function (position) {
            const lat = position.coords.latitude;
            const lng = position.coords.longitude;
            const accuracy = Math.round(position.coords.accuracy);

            currentLatLng = new kakao.maps.LatLng(lat, lng);

            document.getElementById('status-title').innerText = '✅ 위치 갱신 완료';
            document.getElementById('coords').innerHTML =
                `• 위도: ${lat.toFixed(5)} | 경도: ${lng.toFixed(5)}<br>• 오차범위: 약 ±${accuracy}m`;

            myLocationOverlay.setPosition(currentLatLng);
            myLocationOverlay.setMap(map);

            if (isInitial) {
                map.setCenter(currentLatLng);
            } else {
                map.panTo(currentLatLng);
            }

            renderRadiusAndHospitals(currentLatLng, currentRadiusKm);
        },
        function () {
            document.getElementById('status-title').innerText = '⚠️ 기본 위치(서울시청) 적용';
            document.getElementById('coords').innerHTML = `• 위치 권한이 거부되었거나 수신할 수 없습니다.`;
            currentLatLng = new kakao.maps.LatLng(defaultLat, defaultLng);
            renderRadiusAndHospitals(currentLatLng, currentRadiusKm);
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
}

function renderRadiusAndHospitals(center, radiusKm) {
    const radiusMeters = radiusKm * 1000;

    if (activeCircle) activeCircle.setMap(null);
    if (activeCircleLabel) activeCircleLabel.setMap(null);

    activeCircle = new kakao.maps.Circle({
        center: center,
        radius: radiusMeters,
        strokeWeight: 2,
        strokeColor: '#ef4444',
        strokeOpacity: 0.7,
        strokeStyle: 'solid',
        fillColor: '#fee2e2',
        fillOpacity: 0.08
    });
    activeCircle.setMap(map);

    const latOffset = radiusMeters / 111319.5;
    const topPosition = new kakao.maps.LatLng(center.getLat() + latOffset, center.getLng());

    const labelBadge = document.createElement('div');
    labelBadge.className = 'circle-top-label';
    labelBadge.innerText = `${radiusKm}km`;

    activeCircleLabel = new kakao.maps.CustomOverlay({
        position: topPosition,
        content: labelBadge,
        xAnchor: 0.5,
        yAnchor: 1.0,
        zIndex: 5
    });
    activeCircleLabel.setMap(map);

    const lngOffset = radiusMeters / (111319.5 * Math.cos(center.getLat() * (Math.PI / 180)));
    const sw = new kakao.maps.LatLng(center.getLat() - latOffset, center.getLng() - lngOffset);
    const ne = new kakao.maps.LatLng(center.getLat() + latOffset, center.getLng() + lngOffset);
    map.setBounds(new kakao.maps.LatLngBounds(sw, ne));

    filterAndDisplayHospitals(center.getLat(), center.getLng(), radiusKm);
}

function filterAndDisplayHospitals(centerLat, centerLng, radiusKm) {
    clearHospitals();

    if (!cachedHospitals || cachedHospitals.length === 0) return;

    const targetHospitals = [];
    cachedHospitals.forEach(h => {
        const dist = getDistanceKm(centerLat, centerLng, h.lat, h.lng);
        if (dist <= radiusKm) {
            targetHospitals.push({ ...h, distance: dist });
        }
    });

    targetHospitals.forEach(h => {
        createHospitalBubble(h);
    });
}

/**
 * 개별 병원 말풍선 오버레이 생성
 * - 클릭 시 바텀시트를 띄우는 이벤트 바인딩 포함
 */
function createHospitalBubble(h) {
    let bedText = '정보 없음';
    let bedClass = 'bed-warning';

    if (h.hvec !== null && h.hvec !== undefined) {
        if (h.hvec > 5) {
            bedText = `${h.hvec}석 여유`;
            bedClass = 'bed-normal';
        } else if (h.hvec > 0) {
            bedText = `${h.hvec}석 혼잡`;
            bedClass = 'bed-warning';
        } else {
            bedText = '병상 부족';
            bedClass = 'bed-danger';
        }
    }

    const bubble = document.createElement('div');
    bubble.className = 'hospital-bubble';
    bubble.title = '클릭하여 상세 정보 확인';
    bubble.innerHTML = `
        <div class="hospital-name">${h.name}</div>
        <div class="hospital-info">${h.distance.toFixed(1)}km | 📞 ${h.tel || '번호 없음'}</div>
        <div>
            <span style="font-size:10px; color:#64748b;">응급실: </span>
            <span class="bed-badge ${bedClass}">${bedText}</span>
        </div>
    `;

    // 말풍선 클릭 시 바텀시트 오픈
    bubble.addEventListener('click', (e) => {
        e.stopPropagation();
        openHospitalBottomSheet(h, bedText, bedClass);
    });

    const overlay = new kakao.maps.CustomOverlay({
        position: new kakao.maps.LatLng(h.lat, h.lng),
        content: bubble,
        xAnchor: 0.5,
        yAnchor: 1.15,
        zIndex: 6
    });

    overlay.setMap(map);
    hospitalOverlays.push(overlay);
}

function getDistanceKm(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * (Math.PI / 180);
    const dLon = (lon2 - lon1) * (Math.PI / 180);
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

function clearHospitals() {
    hospitalOverlays.forEach(ov => ov.setMap(null));
    hospitalOverlays = [];
}

// ============================================================================
// [바텀시트 오픈 / 제스처 닫기 이벤트 로직]
// ============================================================================
const sheet = document.getElementById('bottom-sheet');
const dim = document.getElementById('sheet-dim');
const dragArea = document.getElementById('sheet-drag-area');

function openHospitalBottomSheet(h, bedText, bedClass) {
    document.getElementById('sheet-hospital-name').innerText = h.name;
    document.getElementById('sheet-distance').innerText = `내 위치로부터 ${h.distance.toFixed(1)}km`;

    const badgeEl = document.getElementById('sheet-bed-badge');
    badgeEl.className = `bed-badge ${bedClass}`;
    badgeEl.innerText = bedText;

    const telLink = document.getElementById('sheet-tel-link');
    if (h.tel) {
        telLink.href = `tel:${h.tel}`;
        telLink.innerText = `📞 ${h.tel} 통화`;
        telLink.style.display = 'inline-block';
    } else {
        telLink.style.display = 'none';
    }

    const msgEl = document.getElementById('sheet-msg-content');
    if (h.message) {
        msgEl.innerHTML = h.message;
        msgEl.style.color = '#991b1b';
    } else {
        msgEl.innerHTML = '현재 등록된 실시간 제한/공지 메시지가 없습니다.';
        msgEl.style.color = '#64748b';
    }

    sheet.style.transform = '';
    sheet.classList.add('open');
    dim.classList.add('active');
}

function closeBottomSheet() {
    sheet.classList.remove('open');
    sheet.style.transform = '';
    dim.classList.remove('active');
}

function initBottomSheetEvents() {
    // 닫기 버튼 및 딤 클릭
    document.getElementById('sheet-close-btn').addEventListener('click', closeBottomSheet);
    dim.addEventListener('click', closeBottomSheet);

    // ========================================================================
    // 터치 및 마우스 드래그로 바텀시트 아래로 쓸어내려 닫기 로직
    // ========================================================================
    let startY = 0;
    let currentY = 0;
    let isDragging = false;

    // 모바일 터치 이벤트
    dragArea.addEventListener('touchstart', (e) => {
        startY = e.touches[0].clientY;
        isDragging = true;
        sheet.style.transition = 'none'; // 드래그 중에는 즉각 반응
    }, { passive: true });

    window.addEventListener('touchmove', (e) => {
        if (!isDragging) return;
        currentY = e.touches[0].clientY;
        const deltaY = currentY - startY;

        // 아래로 내릴 때만 시트 이동
        if (deltaY > 0) {
            sheet.style.transform = `translateY(${deltaY}px)`;
        }
    }, { passive: true });

    window.addEventListener('touchend', () => {
        if (!isDragging) return;
        isDragging = false;
        sheet.style.transition = 'transform 0.25s cubic-bezier(0.2, 0.8, 0.2, 1)';

        const deltaY = currentY - startY;
        // 70px 이상 아래로 내렸으면 닫기, 아니면 원위치
        if (deltaY > 70) {
            closeBottomSheet();
        } else {
            sheet.style.transform = 'translateY(0)';
        }
        startY = 0;
        currentY = 0;
    });

    // 데스크톱 마우스 드래그 이벤트
    dragArea.addEventListener('mousedown', (e) => {
        startY = e.clientY;
        isDragging = true;
        sheet.style.transition = 'none';
    });

    window.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        currentY = e.clientY;
        const deltaY = currentY - startY;
        if (deltaY > 0) {
            sheet.style.transform = `translateY(${deltaY}px)`;
        }
    });

    window.addEventListener('mouseup', () => {
        if (!isDragging) return;
        isDragging = false;
        sheet.style.transition = 'transform 0.25s cubic-bezier(0.2, 0.8, 0.2, 1)';

        const deltaY = currentY - startY;
        if (deltaY > 70) {
            closeBottomSheet();
        } else {
            sheet.style.transform = 'translateY(0)';
        }
        startY = 0;
        currentY = 0;
    });
}