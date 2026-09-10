/* global kakao */

// 공공데이터포털 디코딩된 인증키 (응급의료기관 정보 조회용)
const PUBLIC_API_KEY = decodeURIComponent('s%2FvWNiKH1YndVRu2mPOq7OXAIj%2Byk0M3JTgvN%2B8UVdSFPq8SBR7zuUdG3mxklTrj6WYIiUidSIUwgE8bz09fzQ%3D%3D');

// GPS 수신 실패 또는 초기 실행 시 사용할 기본 좌표 (서울시청 기준)
const defaultLat = 37.5668;
const defaultLng = 126.9786;

/** @type {any} */
// ============================================================================
// 전역 변수 선언부
// ============================================================================
let map = null;                 // 카카오맵 인스턴스를 담을 변수
let myLocationOverlay = null;   // 내 위치를 나타내는 커스텀 점 마커
let currentLatLng = null;       // 현재 사용자의 위경도(Kakao LatLng 객체)
let activeCircle = null;        // 지도 위에 그려진 탐색 반경 원 객체
let activeCircleLabel = null;   // 반경 원 최상단에 표시되는 거리 라벨(CustomOverlay)
let hospitalOverlays = [];      // 지도에 렌더링된 병원 말풍선 오버레이들을 담는 배열
let currentRadiusKm = 10;       // 현재 선택된 탐색 반경 (기본 10km)
let cachedHospitals = [];       // API를 통해 최초 1회 받아온 전체 병원 목록 캐시

// 카카오 지도 SDK 로드 확인 후 앱 초기화 실행
if (typeof kakao === 'undefined' || !kakao.maps) {
    document.getElementById('status-title').innerText = '❌ 카카오 지도 SDK 오류';
} else {
    kakao.maps.load(function () {
        initMap();
    });
}

/**
 * [함수 1] 지도를 초기화하고 화면의 각종 버튼 이벤트 및 지도 이벤트를 바인딩하는 함수
 * - 카카오 지도 인스턴스 생성 및 화면 리사이즈/줌 이벤트 처리
 * - 내 위치 커스텀 마커 생성
 * - 반경 메인 원형 버튼 토글 및 반경 선택 이벤트 등록
 * - 병원 데이터 수신 함수(loadAllEmergencyData) 실행
 */
function initMap() {
    const mapContainer = document.getElementById('map');
    const mapOption = {
        center: new kakao.maps.LatLng(defaultLat, defaultLng),
        level: 6,
        draggable: true,
        scroll_wheel: true
    };

    map = new kakao.maps.Map(mapContainer, mapOption);

    // 브라우저 창 크기가 변경될 때 지도가 깨지지 않도록 영역을 다시 계산
    window.addEventListener('resize', () => {
        if (map) map.relayout();
    });

    // 줌 레벨에 따른 대형 원 렌더링 최적화
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

    // 내 위치 펄스 애니메이션 마커 생성
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

    // ------------------------------------------------------------------------
    // [반경 선택 인터랙션 로직]
    // ------------------------------------------------------------------------
    const radiusMainBtn = document.getElementById('radius-main-btn');
    const radiusOptions = document.getElementById('radius-options');

    // 1. 원형 메인 버튼 클릭 시 옵션 패널 열기/닫기 토글
    if (radiusMainBtn && radiusOptions) {
        radiusMainBtn.addEventListener('click', (e) => {
            e.stopPropagation(); // 이벤트가 상위 document로 전파되어 바로 닫히는 것 방지
            radiusOptions.classList.toggle('open');
        });
    }

    // 2. 펼쳐진 반경 옵션 버튼(5km~100km) 클릭 이벤트
    document.querySelectorAll('.radius-btn').forEach(button => {
        button.addEventListener('click', function (e) {
            e.stopPropagation();

            // 기존 활성 버튼 클래스 제거 후 클릭한 버튼에 active 부여
            document.querySelectorAll('.radius-btn').forEach(b => b.classList.remove('active'));
            this.classList.add('active');

            // 반경 값 갱신 및 지도/병원 다시 그리기
            currentRadiusKm = parseInt(this.getAttribute('data-radius'), 10);
            if (currentLatLng) {
                renderRadiusAndHospitals(currentLatLng, currentRadiusKm);
            }

            // 반경 선택 완료 후 옵션 목록 닫기
            if (radiusOptions) {
                radiusOptions.classList.remove('open');
            }
        });
    });

    // 3. 지도나 화면 빈 공간 클릭 시 열려 있던 옵션 패널 자동 닫기
    document.addEventListener('click', (e) => {
        const wrapper = document.getElementById('radius-menu-wrapper');
        if (wrapper && !wrapper.contains(e.target) && radiusOptions) {
            radiusOptions.classList.remove('open');
        }
    });

    // ------------------------------------------------------------------------
    // 내 위치 이동 버튼 클릭 이벤트
    // ------------------------------------------------------------------------
    document.getElementById('my-loc-btn').addEventListener('click', () => {
        moveToCurrentLocation(false);
    });

    // 앱 시작 시 전체 병원 데이터를 받아온 뒤 현재 위치로 이동
    loadAllEmergencyData().then(() => {
        moveToCurrentLocation(true);
    });
}

/**
 * [함수 2] XML 노드 안에서 특정 태그의 텍스트 값을 안전하게 문자열로 꺼내는 헬퍼 함수
 * @param {Element} parent - 검색 대상 부모 XML 노드
 * @param {string} tagName - 가져올 XML 태그명
 * @returns {string} 추출된 텍스트(없을 경우 빈 문자열 반환)
 */
function getXmlText(parent, tagName) {
    const nodes = parent.getElementsByTagName(tagName);
    if (nodes && nodes.length > 0 && nodes[0].textContent) {
        return String(nodes[0].textContent).trim();
    }
    return '';
}

/**
 * [함수 3] 공공데이터포털 응급의료 API를 호출하여 병원 목록과 실시간 가용 병상 정보를 수집하는 함수
 * - 병원 기본 정보(이름, 전화번호, 좌표 등)와 실시간 응급실 가용 병상 수(hvec)를 병렬 수신
 * - 수신된 데이터를 매핑하여 전역 배열 `cachedHospitals`에 캐싱
 */
async function loadAllEmergencyData() {
    document.getElementById('status-title').innerText = '⏳ 응급의료기관 데이터 수신 중...';

    try {
        const listUrl = `https://apis.data.go.kr/B552657/ErmctInfoInqireService/getEgytListInfoInqire` +
            `?serviceKey=${encodeURIComponent(PUBLIC_API_KEY)}&pageNo=1&numOfRows=1000`;

        const bedUrl = `https://apis.data.go.kr/B552657/ErmctInfoInqireService/getEmrrmRltmUsefulSckbdInfoInqire` +
            `?serviceKey=${encodeURIComponent(PUBLIC_API_KEY)}&pageNo=1&numOfRows=1000`;

        // 두 API 동시 병렬 요청
        const [listRes, bedRes] = await Promise.all([fetch(listUrl), fetch(bedUrl)]);
        const [listXmlText, bedXmlText] = await Promise.all([listRes.text(), bedRes.text()]);

        const parser = new DOMParser();
        const listDoc = parser.parseFromString(listXmlText, 'application/xml');
        const bedDoc = parser.parseFromString(bedXmlText, 'application/xml');

        // 병상 정보 Map 매핑 (Key: 기관코드 hpid, Value: 가용 병상 수 hvec)
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

        // 병원 기본 목록 파싱 및 캐시 배열 구성
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
                    hvec: bedMap.has(hpid) ? bedMap.get(hpid) : null
                });
            }
        }

        document.getElementById('status-title').innerText = '✅ 데이터 준비 완료';
    } catch (err) {
        console.error('데이터 수신 실패:', err);
        document.getElementById('status-title').innerText = '⚠️ 데이터 수신 지연';
    }
}

/**
 * [함수 4] 브라우저 Geolocation API를 사용하여 현재 위치 좌표를 가져오고 지도를 이동시키는 함수
 * - 성공 시: 현재 위치로 지도 중심 이동 및 탐색 반경/병원 렌더링
 * - 실패/거부 시: 서울시청 기본 좌표로 대체 실행
 * @param {boolean} isInitial - 앱 최초 실행 여부 (true면 setCenter, false면 부드러운 panTo)
 */
function moveToCurrentLocation(isInitial) {
    if (!navigator.geolocation) {
        document.getElementById('status-title').innerText = '❌ Geolocation 미지원';
        return;
    }

    navigator.geolocation.getCurrentPosition(
        function (position) {
            const lat = position.coords.latitude;
            const lng = position.coords.longitude;
            currentLatLng = new kakao.maps.LatLng(lat, lng);

            document.getElementById('status-title').innerText = '✅ 위치 갱신 완료';
            document.getElementById('coords').innerHTML = `• 위도: ${lat.toFixed(5)} | 경도: ${lng.toFixed(5)}`;

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
            currentLatLng = new kakao.maps.LatLng(defaultLat, defaultLng);
            renderRadiusAndHospitals(currentLatLng, currentRadiusKm);
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
}

/**
 * [함수 5] 지도 위에 선택된 반경의 원(Circle)과 상단 거리 라벨을 그리고, 화면 영역(Bounds)을 맞추는 함수
 * @param {kakao.maps.LatLng} center - 원의 중심점 좌표
 * @param {number} radiusKm - 반경 거리 (단위: km)
 */
function renderRadiusAndHospitals(center, radiusKm) {
    const radiusMeters = radiusKm * 1000;

    // 기존 원과 라벨 제거
    if (activeCircle) activeCircle.setMap(null);
    if (activeCircleLabel) activeCircleLabel.setMap(null);

    // 새 반경 원 생성
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

    // 원 최상단에 붙일 라벨 위치 계산
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

    // 원 전체가 화면 안에 모두 들어오도록 지도 줌/중심 영역(Bounds) 자동 조절
    const lngOffset = radiusMeters / (111319.5 * Math.cos(center.getLat() * (Math.PI / 180)));
    const sw = new kakao.maps.LatLng(center.getLat() - latOffset, center.getLng() - lngOffset);
    const ne = new kakao.maps.LatLng(center.getLat() + latOffset, center.getLng() + lngOffset);
    map.setBounds(new kakao.maps.LatLngBounds(sw, ne));

    // 반경 내 병원 필터링 및 말풍선 렌더링 호출
    filterAndDisplayHospitals(center.getLat(), center.getLng(), radiusKm);
}

/**
 * [함수 6] 캐시된 전체 병원 중 중심 좌표로부터 선택된 반경(km) 내에 위치한 병원만 필터링하는 함수
 * @param {number} centerLat - 중심 위도
 * @param {number} centerLng - 중심 경도
 * @param {number} radiusKm - 검색 반경(km)
 */
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
 * [함수 7] 개별 병원 정보를 담은 커스텀 말풍선 오버레이(CustomOverlay)를 만들어 지도에 표시하는 함수
 * - 병상 수(hvec)에 따라 여유/혼잡/부족 색상 뱃지 분기 처리
 * @param {Object} h - 병원 정보 객체 (name, distance, tel, hvec, lat, lng)
 */
function createHospitalBubble(h) {
    let bedText = '정보 없음';
    let bedClass = 'bed-warning';

    // 실시간 병상 현황 상태값 분류
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
    bubble.innerHTML = `
        <div class="hospital-name" title="${h.name}">${h.name}</div>
        <div class="hospital-info">${h.distance.toFixed(1)}km | 📞 <a href="tel:${h.tel}" style="color:#007aff; text-decoration:none;">${h.tel || '번호 없음'}</a></div>
        <div>
            <span style="font-size:10px; color:#64748b;">응급실: </span>
            <span class="bed-badge ${bedClass}">${bedText}</span>
        </div>
    `;

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

/**
 * [함수 8] 두 위경도 좌표 사이의 대원(직선) 거리를 구하는 함수 (Haversine 공식)
 * @param {number} lat1 - 지점 1 위도
 * @param {number} lon1 - 지점 1 경도
 * @param {number} lat2 - 지점 2 위도
 * @param {number} lon2 - 지점 2 경도
 * @returns {number} 두 지점 사이의 거리 (단위: km)
 */
function getDistanceKm(lat1, lon1, lat2, lon2) {
    const R = 6371; // 지구 평균 반경 (km)
    const dLat = (lat2 - lat1) * (Math.PI / 180);
    const dLon = (lon2 - lon1) * (Math.PI / 180);
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

/**
 * [함수 9] 지도 위에 표시된 모든 병원 말풍선 오버레이를 화면에서 제거하고 배열을 비우는 함수
 */
function clearHospitals() {
    hospitalOverlays.forEach(ov => ov.setMap(null));
    hospitalOverlays = [];
}