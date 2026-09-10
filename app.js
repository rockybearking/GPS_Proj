/* global kakao */

// 기본 좌표 (서울시청) - GPS 획득 실패 시 사용
const defaultLat = 37.5668;
const defaultLng = 126.9786;

let map = null;
let myLocationOverlay = null;

// 카카오 지도 SDK 체크 및 초기 로드
if (typeof kakao === 'undefined' || !kakao.maps) {
    document.getElementById('status-title').innerText = '❌ 카카오 지도 SDK 오류';
    document.getElementById('status-title').style.color = '#ef4444';
    document.getElementById('coords').innerHTML =
        '카카오 개발자 콘솔에 플랫폼 Web 도메인이 올바르게 등록되어 있는지 확인해 주세요.';
} else {
    kakao.maps.load(function () {
        initMap();
    });
}

// 1. 지도 초기화 및 이벤트 연결
function initMap() {
    const mapContainer = document.getElementById('map');
    const mapOption = {
        center: new kakao.maps.LatLng(defaultLat, defaultLng),
        level: 3,
        draggable: true,
        scroll_wheel: true
    };

    // 지도 생성
    map = new kakao.maps.Map(mapContainer, mapOption);

    // 화면 크기 변경(태블릿 회전, 가상 키보드 등) 시 지도를 다시 계산하여 터치 영역 복구
    window.addEventListener('resize', function () {
        if (map) {
            map.relayout();
        }
    });

    // 파란색 점 마커 DOM 생성
    const markerContent = document.createElement('div');
    markerContent.className = 'my-location-marker';
    markerContent.innerHTML = '<div class="my-location-pulse"></div><div class="my-location-dot"></div>';

    // 커스텀 오버레이로 파란색 점 생성 (중앙 앵커: 0.5, 0.5)
    myLocationOverlay = new kakao.maps.CustomOverlay({
        position: new kakao.maps.LatLng(defaultLat, defaultLng),
        content: markerContent,
        xAnchor: 0.5,
        yAnchor: 0.5,
        zIndex: 5
    });

    // 최초 로딩 시 현재 위치 요청
    moveToCurrentLocation(true);

    // 좌측 하단 원형 버튼 클릭 이벤트 연결
    document.getElementById('my-loc-btn').addEventListener('click', function () {
        moveToCurrentLocation(false);
    });
}

// 2. 현재 위치 가져오기 및 지도 이동
function moveToCurrentLocation(isInitial) {
    if (!navigator.geolocation) {
        document.getElementById('status-title').innerText = '❌ Geolocation 미지원';
        document.getElementById('coords').innerText = '해당 브라우저가 위치 기능을 지원하지 않습니다.';
        return;
    }

    document.getElementById('status-title').innerText = '📍 위치 수신 중...';
    document.getElementById('status-title').style.color = '#007aff';

    navigator.geolocation.getCurrentPosition(
        function (position) {
            const lat = position.coords.latitude;
            const lng = position.coords.longitude;
            const accuracy = Math.round(position.coords.accuracy);
            const currentLatLng = new kakao.maps.LatLng(lat, lng);

            document.getElementById('status-title').innerText = '✅ 현재 위치 수신 완료';
            document.getElementById('status-title').style.color = '#10b981';
            document.getElementById('coords').innerHTML =
                '• 위도: ' + lat.toFixed(5) + '<br>' +
                '• 경도: ' + lng.toFixed(5) + '<br>' +
                '• 오차 반경: 약 ' + accuracy + 'm';

            // 파란 점 마커 위치 업데이트 및 지도 표시
            myLocationOverlay.setPosition(currentLatLng);
            myLocationOverlay.setMap(map);

            // 초기 로딩 시 즉시 이동, 버튼 클릭 시 부드럽게 이동(panTo)
            if (isInitial) {
                map.setCenter(currentLatLng);
            } else {
                map.panTo(currentLatLng);
            }
        },
        function (error) {
            let errorMsg = '위치 권한이 거부되었습니다.';
            if (error.code === 2) errorMsg = '위치를 판별할 수 없습니다.';
            if (error.code === 3) errorMsg = '위치 응답 시간 초과.';

            document.getElementById('status-title').innerText = '⚠️ GPS 수신 불가';
            document.getElementById('status-title').style.color = '#f59e0b';
            document.getElementById('coords').innerHTML = errorMsg + '<br>(브라우저 위치 권한을 확인하세요)';
        },
        {
            enableHighAccuracy: true,
            timeout: 15000,
            maximumAge: 0
        }
    );
}