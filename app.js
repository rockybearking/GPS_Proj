/* global kakao */

// 공공데이터포털 응급의료기관 API 인증키
const PUBLIC_API_KEY = decodeURIComponent('s%2FvWNiKH1YndVRu2mPOq7OXAIj%2Byk0M3JTgvN%2B8UVdSFPq8SBR7zuUdG3mxklTrj6WYIiUidSIUwgE8bz09fzQ%3D%3D');

// 위치 권한 미허용 시 사용할 기본 좌표 (서울시청)
const defaultLat = 37.5668;
const defaultLng = 126.9786;

// ============================================================================
// 전역 변수 선언부
// ============================================================================
let map = null;                    // 카카오 지도 인스턴스
let myLocationOverlay = null;      // 내 위치 커스텀 오버레이
let currentLatLng = null;          // 현재 기준 중심 좌표 (LatLng)
let activeCircle = null;           // 반경 시각화 Circle 객체
let activeCircleLabel = null;      // 반경 상단 거리 표기 라벨 오버레이
let hospitalOverlays = [];         // 지도에 표시된 병원 마커 오버레이 배열
let currentRadiusKm = 10;          // 현재 설정된 탐색 반경 (기본: 10km)
let cachedHospitals = [];          // 공공데이터포털에서 받아온 병원 전체 목록 캐시

// 병원 분류 필터 상태 객체 (상급종합병원, 지역의료, 일반병원)
let hospitalFilters = {
    tertiary: true, // 상급종합병원
    regional: true, // 지역의료 (의료원)
    general: true   // 일반병원
};

// ============================================================================
// 1. 십진수 좌표 -> 도·분·초(DMS) 포맷 변환 함수
// ============================================================================
function toDMS(decimalCoord) {
    const abs = Math.abs(decimalCoord);
    const degrees = Math.floor(abs);
    const minutesFloat = (abs - degrees) * 60;
    const minutes = Math.floor(minutesFloat);
    const seconds = ((minutesFloat - minutes) * 60).toFixed(1);
    return `${degrees}도 ${minutes}분 ${seconds}초`;
}

// ============================================================================
// 2. 반경 거리별 색상 테마 계산 함수
//    - 5, 10km  : 파란색
//    - 15, 20km : 초록색
//    - 30, 40km : 노란색/호박색
//    - 50, 100km 및 전국 : 빨간색
// ============================================================================
function getRadiusTheme(radiusKm) {
    if (radiusKm <= 10) {
        return {
            strokeColor: '#2563eb', // 파랑
            fillColor: '#3b82f6',
            fillOpacity: 0.08,
            labelBg: '#2563eb'
        };
    } else if (radiusKm <= 20) {
        return {
            strokeColor: '#16a34a', // 초록
            fillColor: '#22c55e',
            fillOpacity: 0.08,
            labelBg: '#16a34a'
        };
    } else if (radiusKm <= 40) {
        return {
            strokeColor: '#d97706', // 노랑/호박색
            fillColor: '#facc15',
            fillOpacity: 0.12,
            labelBg: '#d97706'
        };
    } else {
        return {
            strokeColor: '#ef4444', // 빨강 (50km, 100km, 전국)
            fillColor: '#f87171',
            fillOpacity: 0.08,
            labelBg: '#ef4444'
        };
    }
}

// ============================================================================
// 3. 지도 및 애플리케이션 초기화
// ============================================================================
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

    // 윈도우 크기 변경 시 지도 릴레이아웃
    window.addEventListener('resize', () => {
        if (map) map.relayout();
    });

    // 줌 레벨 변경 시 반경 원 노출 여부 조정
    kakao.maps.event.addListener(map, 'zoom_changed', function () {
        const level = map.getLevel();
        if (!activeCircle) return;

        // 전국(600km) 등 초광역 반경은 줌 레벨에 상관없이 원 항상 유지
        if (currentRadiusKm >= 500) {
            if (!activeCircle.getMap()) activeCircle.setMap(map);
            if (activeCircleLabel && !activeCircleLabel.getMap()) activeCircleLabel.setMap(map);
        } else if (currentRadiusKm >= 20 && level <= 4) {
            if (activeCircle.getMap()) activeCircle.setMap(null);
            if (activeCircleLabel && activeCircleLabel.getMap()) activeCircleLabel.setMap(null);
        } else {
            if (!activeCircle.getMap()) activeCircle.setMap(map);
            if (activeCircleLabel && !activeCircleLabel.getMap()) activeCircleLabel.setMap(map);
        }
    });

    // 내 위치 펄스 애니메이션 커스텀 오버레이 생성
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
    // UI 이벤트 리스너 바인딩
    // ------------------------------------------------------------------------
    const radiusMainBtn = document.getElementById('radius-main-btn');
    const radiusOptions = document.getElementById('radius-options');
    const filterMainBtn = document.getElementById('filter-main-btn');
    const filterOptions = document.getElementById('filter-options');

    // 반경 메뉴 버튼 클릭 시 팝업 토글 (필터 팝업은 닫음)
    if (radiusMainBtn && radiusOptions) {
        radiusMainBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            filterOptions.classList.remove('open');
            radiusOptions.classList.toggle('open');
        });
    }

    // 필터 메뉴 버튼 클릭 시 팝업 토글 (반경 팝업은 닫음)
    if (filterMainBtn && filterOptions) {
        filterMainBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            radiusOptions.classList.remove('open');
            filterOptions.classList.toggle('open');
        });
    }

    // ------------------------------------------------------------------------
    // [개선 3] 지도 드래그 시 메뉴가 사라지지 않도록 드래그 여부 판별
    // ------------------------------------------------------------------------
    let isPageDragging = false;
    let pageDownX = 0;
    let pageDownY = 0;

    // 마우스 누름 시작 좌표 기록
    document.addEventListener('mousedown', (e) => {
        isPageDragging = false;
        pageDownX = e.clientX;
        pageDownY = e.clientY;
    });

    // 마우스가 일정 거리(6px) 이상 움직이면 드래그 상태로 판단
    document.addEventListener('mousemove', (e) => {
        if (Math.abs(e.clientX - pageDownX) > 6 || Math.abs(e.clientY - pageDownY) > 6) {
            isPageDragging = true;
        }
    });

    // 모바일 터치 드래그 감지
    document.addEventListener('touchstart', (e) => {
        if (e.touches.length > 0) {
            isPageDragging = false;
            pageDownX = e.touches[0].clientX;
            pageDownY = e.touches[0].clientY;
        }
    }, { passive: true });

    document.addEventListener('touchmove', (e) => {
        if (e.touches.length > 0) {
            if (Math.abs(e.touches[0].clientX - pageDownX) > 6 || Math.abs(e.touches[0].clientY - pageDownY) > 6) {
                isPageDragging = true;
            }
        }
    }, { passive: true });

    // 바깥 영역을 단순 "클릭"했을 때만 메뉴를 닫고, "드래그"했을 때는 닫지 않음
    document.addEventListener('click', (e) => {
        if (isPageDragging) {
            isPageDragging = false;
            return; // 드래그 동작 후 손을 뗐을 때 발생한 클릭 이벤트는 무시
        }

        const radiusWrapper = document.getElementById('radius-menu-wrapper');
        const filterWrapper = document.getElementById('filter-menu-wrapper');

        if (radiusWrapper && !radiusWrapper.contains(e.target) && radiusOptions) {
            radiusOptions.classList.remove('open');
        }
        if (filterWrapper && !filterWrapper.contains(e.target) && filterOptions) {
            filterOptions.classList.remove('open');
        }
    });

    // 반경 선택 버튼 클릭 이벤트
    document.querySelectorAll('.radius-btn').forEach(button => {
        button.addEventListener('click', function (e) {
            e.stopPropagation();
            document.querySelectorAll('.radius-btn').forEach(b => {
                b.classList.remove('active');
                b.style.backgroundColor = '';
                b.style.borderColor = '';
            });
            this.classList.add('active');

            currentRadiusKm = parseInt(this.getAttribute('data-radius'), 10);

            // 활성화 버튼 색상을 반경 테마 색상과 연동
            const theme = getRadiusTheme(currentRadiusKm);
            this.style.backgroundColor = theme.labelBg;
            this.style.borderColor = theme.labelBg;

            if (currentLatLng) {
                renderRadiusAndHospitals(currentLatLng, currentRadiusKm);
            }
            if (radiusOptions) {
                radiusOptions.classList.remove('open');
            }
        });
    });

    // ------------------------------------------------------------------------
    // [개선 1] 상급종합, 지역의료, 일반병원 필터 체크박스 이벤트 바인딩
    // ------------------------------------------------------------------------
    const filterTertiary = document.getElementById('filter-tertiary');
    const filterRegional = document.getElementById('filter-regional');
    const filterGeneral = document.getElementById('filter-general');

    const handleFilterChange = () => {
        hospitalFilters.tertiary = filterTertiary.checked;
        hospitalFilters.regional = filterRegional.checked;
        hospitalFilters.general = filterGeneral.checked;

        if (currentLatLng) {
            filterAndDisplayHospitals(currentLatLng.getLat(), currentLatLng.getLng(), currentRadiusKm);
        }
    };

    filterTertiary.addEventListener('change', handleFilterChange);
    filterRegional.addEventListener('change', handleFilterChange);
    filterGeneral.addEventListener('change', handleFilterChange);

    // 내 위치 이동 버튼
    document.getElementById('my-loc-btn').addEventListener('click', () => {
        moveToCurrentLocation(false);
    });

    // 주소 검색 엔터 및 클릭 지원
    const searchBtn = document.getElementById('search-btn');
    const keywordInput = document.getElementById('keyword');
    const handleSearch = () => {
        const query = keywordInput.value.trim();
        if (!query) return;
        if (!kakao.maps.services || !kakao.maps.services.Geocoder) {
            alert('주소 검색 서비스를 불러오는 중입니다.');
            return;
        }
        const geocoder = new kakao.maps.services.Geocoder();
        geocoder.addressSearch(query, (result, status) => {
            if (status === kakao.maps.services.Status.OK) {
                const lat = parseFloat(result[0].y);
                const lng = parseFloat(result[0].x);
                currentLatLng = new kakao.maps.LatLng(lat, lng);
                map.panTo(currentLatLng);
                myLocationOverlay.setPosition(currentLatLng);
                myLocationOverlay.setMap(map);

                document.getElementById('status-title').innerText = `📍 검색 위치: ${query}`;
                document.getElementById('coords').innerHTML =
                    `• 위도: ${toDMS(lat)}<br>• 경도: ${toDMS(lng)}<br>• 기준: 검색 주소 중심`;

                renderRadiusAndHospitals(currentLatLng, currentRadiusKm);
            } else {
                alert('해당 주소를 찾을 수 없습니다.');
            }
        });
    };

    searchBtn.addEventListener('click', handleSearch);
    keywordInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') handleSearch();
    });

    // 초기 데이터 비동기 로드 후 현재 위치 추적 시작
    loadAllEmergencyData().then(() => {
        moveToCurrentLocation(true);
    });
}

// XML 노드에서 텍스트 값을 안전하게 추출하는 보조 함수
function getXmlText(parent, tagName) {
    const nodes = parent.getElementsByTagName(tagName);
    if (nodes && nodes.length > 0 && nodes[0].textContent) {
        return String(nodes[0].textContent).trim();
    }
    return '';
}

// ============================================================================
// 4. 국립중앙의료원 응급의료 Open API 데이터 병렬 수신
//    (1) 전국 응급의료기관 기본 목록
//    (2) 실시간 가용 병상 정보
//    (3) 중증질환 수용불가 등 실시간 특이사항 메시지
// ============================================================================
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

        // 1. 가용 병상 맵 (hpid -> 가용병상 수)
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

        // 2. 실시간 특이사항 메시지 맵 (hpid -> 공지 문자열)
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

        // 3. 병원 목록 데이터 파싱 및 [상급종합 / 지역의료 / 일반] 3분류 적용
        cachedHospitals = [];
        const listItems = listDoc.getElementsByTagName('item');
        for (let i = 0; i < listItems.length; i++) {
            const item = listItems[i];
            const hpid = getXmlText(item, 'hpid');
            const name = getXmlText(item, 'dutyName') || '응급의료기관';
            const tel = getXmlText(item, 'dutyTel1');
            const latStr = getXmlText(item, 'wgs84Lat');
            const lngStr = getXmlText(item, 'wgs84Lon');
            const dutyDivNam = getXmlText(item, 'dutyDivNam');
            const dutyEmclsName = getXmlText(item, 'dutyEmclsName');

            const lat = parseFloat(latStr);
            const lng = parseFloat(lngStr);

            if (!isNaN(lat) && !isNaN(lng)) {
                let type = 'general';
                let typeLabel = '일반병원';

                // [개선 1] '의료원'이 포함된 경우 -> '지역의료'로 최우선 분류
                if (name.includes('의료원')) {
                    type = 'regional';
                    typeLabel = '지역의료';
                } else {
                    // 상급종합병원(대학병원 등) 판별 로직
                    const isTertiary = (
                        dutyDivNam.includes('상급종합') ||
                        dutyEmclsName.includes('권역') ||
                        /대학|대학교|의과대학|세브란스|아산병원|삼성서울|성모병원/.test(name)
                    );
                    if (isTertiary) {
                        type = 'tertiary';
                        typeLabel = '상급종합';
                    }
                }

                cachedHospitals.push({
                    hpid,
                    name,
                    tel,
                    lat,
                    lng,
                    type,
                    typeLabel,
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

// ============================================================================
// 5. 현재 내 GPS 위치 조회 및 지도 이동 함수
// ============================================================================
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
                `• 위도: ${toDMS(lat)}<br>• 경도: ${toDMS(lng)}<br>• 오차범위: 약 ±${accuracy}m`;

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
            document.getElementById('coords').innerHTML =
                `• 위도: ${toDMS(defaultLat)}<br>• 경도: ${toDMS(defaultLng)}<br>• 위치 권한 미허용 상태`;
            currentLatLng = new kakao.maps.LatLng(defaultLat, defaultLng);
            renderRadiusAndHospitals(currentLatLng, currentRadiusKm);
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
}

// ============================================================================
// 6. 반경 원(Circle) 및 거리 라벨 렌더링
// ============================================================================
function renderRadiusAndHospitals(center, radiusKm) {
    const radiusMeters = radiusKm * 1000;
    const theme = getRadiusTheme(radiusKm);

    if (activeCircle) activeCircle.setMap(null);
    if (activeCircleLabel) activeCircleLabel.setMap(null);

    // 반경 원 생성
    activeCircle = new kakao.maps.Circle({
        center: center,
        radius: radiusMeters,
        strokeWeight: 2.2,
        strokeColor: theme.strokeColor,
        strokeOpacity: 0.8,
        strokeStyle: 'solid',
        fillColor: theme.fillColor,
        fillOpacity: theme.fillOpacity
    });
    activeCircle.setMap(map);

    // 상단 거리 표시 라벨 위치 계산
    const latOffset = radiusMeters / 111319.5;
    const topPosition = new kakao.maps.LatLng(center.getLat() + latOffset, center.getLng());

    const labelBadge = document.createElement('div');
    labelBadge.className = 'circle-top-label';
    labelBadge.style.backgroundColor = theme.labelBg;
    labelBadge.innerText = radiusKm >= 500 ? '전국' : `${radiusKm}km`;

    activeCircleLabel = new kakao.maps.CustomOverlay({
        position: topPosition,
        content: labelBadge,
        xAnchor: 0.5,
        yAnchor: 1.0,
        zIndex: 5
    });
    activeCircleLabel.setMap(map);

    // 지도 뷰포트를 원 전체가 보이도록 바운즈 맞춤
    const cosLat = Math.cos(center.getLat() * (Math.PI / 180));
    const lngOffset = radiusMeters / (111319.5 * (cosLat === 0 ? 1 : cosLat));
    const sw = new kakao.maps.LatLng(center.getLat() - latOffset, center.getLng() - lngOffset);
    const ne = new kakao.maps.LatLng(center.getLat() + latOffset, center.getLng() + lngOffset);
    map.setBounds(new kakao.maps.LatLngBounds(sw, ne));

    filterAndDisplayHospitals(center.getLat(), center.getLng(), radiusKm);
}

// ============================================================================
// 7. 병원 필터링 및 오버레이 렌더링 (거리 + 분류 체크박스 조건 적용)
// ============================================================================
function filterAndDisplayHospitals(centerLat, centerLng, radiusKm) {
    clearHospitals();

    if (!cachedHospitals || cachedHospitals.length === 0) return;

    const targetHospitals = [];
    cachedHospitals.forEach(h => {
        const dist = getDistanceKm(centerLat, centerLng, h.lat, h.lng);
        if (dist <= radiusKm) {
            // [개선 1] 상급종합(tertiary), 지역의료(regional), 일반(general) 체크 여부 확인
            if (hospitalFilters[h.type]) {
                targetHospitals.push({ ...h, distance: dist });
            }
        }
    });

    targetHospitals.forEach(h => {
        createHospitalBubble(h);
    });
}

// ============================================================================
// 8. 병원 말풍선(버블) 오버레이 생성
// ============================================================================
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

    // [개선 1] 분류별 배지 CSS 클래스 매핑 (상급: 빨간색, 지역: 파란색, 일반: 기본색)
    let typeBadgeClass = 'hospital-type-general';
    if (h.type === 'tertiary') {
        typeBadgeClass = 'hospital-type-tertiary';
    } else if (h.type === 'regional') {
        typeBadgeClass = 'hospital-type-regional';
    }

    const bubble = document.createElement('div');
    bubble.className = 'hospital-bubble';
    bubble.title = '클릭하여 상세 정보 확인';
    bubble.innerHTML = `
        <div class="hospital-name">
            <span class="hospital-type-badge ${typeBadgeClass}">${h.typeLabel}</span>
            ${h.name}
        </div>
        <div class="hospital-info">${h.distance.toFixed(1)}km | 📞 ${h.tel || '번호 없음'}</div>
        <div>
            <span style="font-size:10px; color:#64748b;">응급실: </span>
            <span class="bed-badge ${bedClass}">${bedText}</span>
        </div>
    `;

    // ------------------------------------------------------------------------
    // [개선 2] PC에서 버블을 누른 채 지도를 드래그할 때 버블이 열리는 문제 해결
    // ------------------------------------------------------------------------
    let isDraggingBubble = false;
    let bubbleDownX = 0;
    let bubbleDownY = 0;

    bubble.addEventListener('mousedown', (e) => {
        isDraggingBubble = false;
        bubbleDownX = e.clientX;
        bubbleDownY = e.clientY;
    });

    bubble.addEventListener('mousemove', (e) => {
        const dx = Math.abs(e.clientX - bubbleDownX);
        const dy = Math.abs(e.clientY - bubbleDownY);
        // 마우스 누른 상태에서 5px 이상 이동 시 드래그 상태로 인지
        if (dx > 5 || dy > 5) {
            isDraggingBubble = true;
        }
    });

    bubble.addEventListener('click', (e) => {
        e.stopPropagation();
        // 드래그 중 발생한 클릭 이벤트는 무시하고, 단순 클릭일 때만 상세 바텀시트 열기
        if (isDraggingBubble) {
            isDraggingBubble = false;
            return;
        }
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

// 두 좌표 간 거리 계산 (하버사인 공식, 단위: km)
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

// 기존 병원 오버레이 전체 제거
function clearHospitals() {
    hospitalOverlays.forEach(ov => ov.setMap(null));
    hospitalOverlays = [];
}

// ============================================================================
// 9. 바텀시트 열기 / 닫기 및 드래그 제스처 처리
// ============================================================================
const sheet = document.getElementById('bottom-sheet');
const dim = document.getElementById('sheet-dim');
const dragArea = document.getElementById('sheet-drag-area');

function openHospitalBottomSheet(h, bedText, bedClass) {
    document.getElementById('sheet-hospital-name').innerText = h.name;
    document.getElementById('sheet-distance').innerText = `내 위치로부터 ${h.distance.toFixed(1)}km`;

    // 기관 유형 뱃지 갱신 (상급: 빨간색, 지역: 파란색, 일반: 기본색)
    const typeEl = document.getElementById('sheet-hospital-type');
    typeEl.innerText = h.typeLabel;

    let badgeClass = 'hospital-type-general';
    if (h.type === 'tertiary') {
        badgeClass = 'hospital-type-tertiary';
    } else if (h.type === 'regional') {
        badgeClass = 'hospital-type-regional';
    }
    typeEl.className = `hospital-type-badge ${badgeClass}`;

    // 가용 병상 상태 뱃지 갱신
    const badgeEl = document.getElementById('sheet-bed-badge');
    badgeEl.className = `bed-badge ${bedClass}`;
    badgeEl.innerText = bedText;

    // 전화 연결 버튼
    const telLink = document.getElementById('sheet-tel-link');
    if (h.tel) {
        telLink.href = `tel:${h.tel}`;
        telLink.innerText = `📞 ${h.tel} 통화`;
        telLink.style.display = 'inline-block';
    } else {
        telLink.style.display = 'none';
    }

    // 실시간 공지 메시지 표기
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
    document.getElementById('sheet-close-btn').addEventListener('click', closeBottomSheet);
    dim.addEventListener('click', closeBottomSheet);

    let startY = 0;
    let currentY = 0;
    let isDragging = false;

    // 모바일 터치 제스처로 바텀시트 아래로 쓸어내려 닫기
    dragArea.addEventListener('touchstart', (e) => {
        startY = e.touches[0].clientY;
        isDragging = true;
        sheet.style.transition = 'none';
    }, { passive: true });

    window.addEventListener('touchmove', (e) => {
        if (!isDragging) return;
        currentY = e.touches[0].clientY;
        const deltaY = currentY - startY;
        if (deltaY > 0) {
            sheet.style.transform = `translateY(${deltaY}px)`;
        }
    }, { passive: true });

    window.addEventListener('touchend', () => {
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

    // 데스크톱 마우스 드래그로 바텀시트 닫기
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