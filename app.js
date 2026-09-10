/* global kakao */

// 기본 좌표 (서울시청) - GPS 획득 실패 시 대체용
const defaultLat = 37.5668;
const defaultLng = 126.9786;

// 1. 브라우저 위치 정보(GPS) 우선 요청
if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
        function(position) {
            const lat = position.coords.latitude;
            const lng = position.coords.longitude;
            const accuracy = Math.round(position.coords.accuracy);

            document.getElementById('status-title').innerText = '✅ 현재 위치 수신 완료';
            document.getElementById('status-title').style.color = '#10b981';
            document.getElementById('coords').innerHTML =
                '• 위도: ' + lat.toFixed(5) + '<br>' +
                '• 경도: ' + lng.toFixed(5) + '<br>' +
                '• 오차 반경: 약 ' + accuracy + 'm';

            // 수신된 실제 GPS 위치로 지도 생성
            renderMap(lat, lng, '현재 내 위치');
        },
        function(error) {
            let errorMsg = '위치 권한이 거부되었습니다.';
            if (error.code === 2) errorMsg = '위치를 판별할 수 없습니다.';
            if (error.code === 3) errorMsg = '위치 응답 시간 초과.';

            document.getElementById('status-title').innerText = '⚠️ GPS 수신 불가 (기본 위치 표시)';
            document.getElementById('status-title').style.color = '#f59e0b';
            document.getElementById('coords').innerHTML = errorMsg + '<br>(브라우저 위치 권한을 확인하세요)';

            // GPS 실패 시에도 기본 위치로 지도 표시
            renderMap(defaultLat, defaultLng, '기본 위치 (서울시청)');
        },
        {
            enableHighAccuracy: true,
            timeout: 20000,
            maximumAge: 0
        }
    );
} else {
    document.getElementById('status-title').innerText = '❌ Geolocation 미지원';
    document.getElementById('coords').innerText = '해당 브라우저가 위치 기능을 지원하지 않습니다.';
    renderMap(defaultLat, defaultLng, '기본 위치');
}

// 2. 카카오 지도 렌더링 함수
function renderMap(lat, lng, labelText) {
    if (typeof kakao === 'undefined' || !kakao.maps) {
        document.getElementById('status-title').innerText = '❌ 카카오 지도 SDK 오류';
        document.getElementById('status-title').style.color = '#ef4444';
        document.getElementById('coords').innerHTML =
            '카카오 개발자 콘솔에 <b>https://rockybearking.github.io</b> 가 등록되어 있는지 확인해 주세요.';
        return;
    }

    kakao.maps.load(function() {
        const mapContainer = document.getElementById('map');
        const mapOption = {
            center: new kakao.maps.LatLng(lat, lng),
            level: 3
        };
        const map = new kakao.maps.Map(mapContainer, mapOption);

        // 마커 생성
        const marker = new kakao.maps.Marker({
            position: new kakao.maps.LatLng(lat, lng),
            map: map
        });

        // 정보 창 띄우기
        const infowindow = new kakao.maps.InfoWindow({
            content: '<div style="padding:6px 10px; font-size:12px; font-weight:bold; min-width:100px; text-align:center;">' + labelText + '</div>'
        });
        infowindow.open(map, marker);
    });
}