# 레이아웃 커스터마이징

## 패널 폭 조절

좌측/중앙/우측 사이 splitter를 드래그하면 패널 폭이 바뀝니다.

저장 위치:

- 비로그인: browser localStorage `kt.layout`
- 로그인: localStorage + 사용자 설정 `settings.layout`

## 위젯 위치 변경

각 위젯 헤더를 드래그해서 같은 패널 또는 다른 패널로 이동할 수 있습니다.

구조:

```js
state.layout.tabs[tab] = {
  left: ['market-pulse', 'watchlist'],
  center: ['chart', 'news'],
  right: ['ai-assistant']
}
```

## 위젯 크기 조절

각 위젯은 CSS `resize: both`가 적용되어 있습니다. 크기 변경 후 높이는 `ResizeObserver`로 저장됩니다.

## 초기 레이아웃 수정

`public/app.js`의 `DEFAULT_VIEWS`를 수정하십시오.

```js
const DEFAULT_VIEWS = {
  market: {
    left: ['market-pulse', 'watchlist', 'data-sources'],
    center: ['chart', 'rates-commodities', 'news'],
    right: ['ai-assistant', 'sec-filings', 'order-ticket']
  }
}
```

## 레이아웃 초기화

Settings 위젯에서 `RESET LAYOUT`을 누르면 localStorage 레이아웃이 삭제되고 기본 레이아웃으로 돌아갑니다.
