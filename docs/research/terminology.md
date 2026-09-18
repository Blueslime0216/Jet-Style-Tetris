# 테트리스 용어와 정적 지식 조사

2026-09-18 조사. 사용자 최종 기획서의 Phase 1–2에 대응한다. 원문 전문 대신 직접 쓴 정의, 출처 메타데이터, 필요한 일부 Fumen 기하만 저장했다. 웹은 개발 시 조사에만 사용하며 실행 중에는 저장소의 JSON을 읽는다.

## 실행 가능성과 지식의 구분

현재 조사 자료는 23개 용어, 21개 전략 항목, 25개 출처, 36개 Fumen/129개 page이다. 출처는 독립적으로 작성된 설명·도해, 작성자 본인의 시연, 개발자 문서로 구분했다. FOUR의 설명을 해당 빌드 발명자의 원문이라고 주장하지 않는다. Hachispin은 FOUR가 연결한 발명자 원본 Fumen도 확보했다.

`knowledge/raw/catalog.json`은 정의와 전략 관계, `knowledge/raw/fumen-fixtures.json`은 원본에서 해독한 보드를 제공한다. 원본 해독은 실제 플레이 검증이 아니다. 모든 원시 항목의 `executable` 및 `runtimeEnabled`는 false이며 엔진 검증을 거친 파생 계획만 후보로 승격한다. 좌표를 추측하지 않았고 성공률을 임의로 넣지 않았다.

## 주요 용어

| 용어 | 의미와 구현 시 주의 |
|---|---|
| PC / Perfect Clear | 줄 삭제 뒤 필드에 고정 블록이 하나도 남지 않은 상태. 낮은 스택이나 평평한 지형을 PC 가능으로 표시하지 않는다. |
| TSS / TSD / TST | 엔진이 인정한 T스핀으로 각각 1/2/3줄 삭제. 마지막 회전과 kick을 확인하며 mini/full은 별도다. |
| Opener | 빈 필드 근처에서 사용하는 초기 계획. 순서·hold·회전·가비지에 따라 가능한 branch가 달라진다. |
| Midgame setup | 현재 지형에 적용하는 패턴. 고정 완성판과 현재 판의 단순 유사도만으로 실행 가능이라고 하지 않는다. |
| Donation | 아래 지형을 활용·보존하면서 그 위에서 스핀 삭제를 만드는 기법. |
| B2B | 어려운 줄 삭제의 연쇄. 유지·해제 조건과 공격량은 룰셋마다 다르다. |
| All-spin | T 이외 피스의 스핀을 인정하는 룰 계열. SRS 지원과 별개의 기능이다. |
| 7-bag / hold | 가방에 7종이 한 번씩 있으며 hold 잔여와 가방 경계가 다음 빌드의 가용성에 영향을 준다. |
| Fumen | 필드·피스·플래그를 저장하는 도해 형식. page 사이에 편집이나 대안 분기가 있으므로 곧바로 replay가 아니다. |
| Downstack | 아래 지형·쓰레기줄에 접근해 제거하는 행동. 안전성 판단은 실제 가비지와 막힌 칸으로 계산한다. |

정의와 직접 도해는 [Basic T-spins](https://howtotetris.com/basic-t-spins/), [PCO](https://four.lol/perfect-clears/opener/), [DPC](https://four.lol/perfect-clears/dpc/), [STMB](https://four.lol/methods/stmb/), [tetris-fumen 구현](https://github.com/knewjade/tetris-fumen)을 대조했다. 게임 간 공격량을 일반화하지 않는다.

## 오프너

| 항목 | 기록한 목표 | 주의 |
|---|---|---|
| [TKI](https://four.lol/openers/tki/) | 첫 가방 TSD | early I는 대략적 신호다. 일본어 TKI는 C-Spin을 가리키기도 한다. |
| [PCO](https://four.lol/perfect-clears/opener/) | PC 탐색용 초기 모양 | hold I와 다음 순서가 중요하며 PC는 별도 탐색으로 증명한다. |
| [DT Cannon](https://four.lol/methods/dt-cannon/) | TSD → TST | 초기 L/S 또는 J 계열 branch. 중반 활용도 별도로 존재한다. |
| [Albatross](https://four.lol/openers/albatross/) | 공중 TSD → TST → TSD | O와 soft drop 가용성 확인. |
| [MKO](https://four.lol/openers/mko/) | PC 또는 TSD | J/L 초기 순서, 다음 가방 overhang 조각을 확인. |
| [Hachispin](https://four.lol/openers/hachispin/) | TSS → TST → 선택적 PC | TSS 금지와 충돌한다. 원작자 Fumen의 앞 14개 operation도 확보했다. |
| [SDPC](https://four.lol/openers/sd-pc/) | TSS → TSD → 선택적 PC | TSS 금지와 충돌한다. PC 완성을 보장하지 않는다. |

각 항목에는 실제 원본 Fumen과 해독 좌표가 연결된다. 도해의 색으로 복원한 `coloredPlacements`는 배치 순서가 없는 집합이다. 현재 queue에서 해당 집합을 만들 수 있는지 엔진이 hold와 도달성을 검사해야 한다.

## 중반과 루프

중반 fixture는 [STSD](https://four.lol/methods/stsd/), [Fractal](https://four.lol/methods/fractal/), [C-Spin](https://four.lol/methods/triple-double/#c-spin), [Kaidan](https://four.lol/methods/kaidan/), [STMB Cave](https://four.lol/methods/stmb/)를 포함한다. STSD와 Fractal은 두 TSD를 만들지만 기하와 회전 경로가 다르다. C-Spin은 J/L 구조를 이용한 TST→TSD 계열이다. Kaidan은 계단 모양에서 S/Z를 이용하고, STMB는 3열 틈 위의 공중 TSD에 해당한다.

[LST](https://four.lol/stacking/lst/)는 조각을 정해진 순서로 무한히 반복하는 replay가 아니라 반복 가능한 overhang·스태킹 구조다. [DPC](https://four.lol/perfect-clears/dpc/)는 첫 3가방에서 20피스를 사용해 8줄 PC를 한 뒤 잔여 1피스로 TSD→PC를 만들고 새 가방 상태로 돌아가는 계열이다. [Infinite TST](https://four.lol/methods/tspin-triple/#infinite-tst)는 TST 반복 기법의 이름이며 모든 순서나 가비지 조건에서 무한 성공한다는 뜻은 아니다.

## 6-3, 9-0, LST의 구분과 실행 목표

2026-09-18 사용자가 “6-3 스태킹을 잘못 말한 거야. 이거는 내 실수야. 중앙을 비우고 쌓거나, 끝을 비우고 쌓는 스태킹 기법이야”라고 정정했다. 이전 기획 원문과 출처 Fumen은 보존하고, 현재 catalog의 미확정 4-3 항목을 6-3로 교체했다. 정정 출처는 `knowledge/sources/user-corrections.json`에 기록했다.

[Tetris Effect: Connected 공식 사이트의 가이드](https://www.tetriseffect.game/beginners-community-guide/)가 설명하는 구분에 따라, 6-3는 왼쪽 6열·중간 1열 well·오른쪽 3열이다. 기본 well은 0-based `x=6`이며 좌우 반전은 `x=3`이다. 9-0는 오른쪽 끝 `x=9`를 비우고 나머지 9열을 쌓는다. 반전인 왼쪽 끝 `x=0`은 정확히는 0-9이다. 둘 다 단일 열 well을 쓰지만 같은 이름으로 취급하지 않는다.

`knowledge/raw/stacking-targets.json`에 이 구분을 계산 가능한 목표로 적었다. 6-3의 한 줄 마스크는 `XXXXXX_XXX`, 9-0는 `XXXXXXXXX_`다. 이는 정의를 수학적으로 표현한 마스크이며, 그 자체가 실제 피스로 만든 보드나 성공 경로라는 주장은 아니다. 평탄도는 well을 건너뛴 각 스택 내부의 인접 높이 차로 계산한다. well에 들어간 피스가 줄을 지웠다면 채널 방해로 벌점을 주지 않는다. 마스크와 맞는 연속 4줄이 있어도 I의 도달성과 실제 4줄 삭제를 엔진이 확인해야 한다.

[MKO의 6-3 continuation 도해](https://four.lol/openers/mko/#6-3-stacking)를 추가 확보했다 (`six-three-diagram-3/4/5`). 이 예시는 x3 쪽의 반전 방향이고 T스핀을 만드는 중간 단계이므로 모든 순간에 well 한 열 전체가 비어 있지는 않다. x6 기준으로 반전할 때는 `x'=9-x` 및 J↔L/S↔Z 변환이 필요하다.

LST는 well 위치의 이름이 아니라 [L/J overhang → TSD → 보충 → S/Z overhang → TSD → 보충](https://four.lol/stacking/lst/)의 기하 반복이다. `lst-diagram-5` page0은 첫 TSD 전 지형, page1은 T칸을 채운 상태, page2는 삭제 후 지형이다. 단계6/7/8이 뒤의 보충과 다른 overhang 단계를 담는다. `stacking-targets.json`은 이들 원본의 정확한 점유 mask를 별도로 제공한다. 다만 원본 색은 영역 표시에도 쓰이므로 O색 영역을 O피스 배치라고 해석하면 안 된다.

추가 확인 과정에서 기존 `lst-diagram-2`가 해당 페이지의 **ST 비교 그림**임을 확인했다. 원본을 보존하고 annotation을 붙였으며 LST 목표 목록에서는 제외했다. LST의 실제 판정에는 단계별 빈칸·점유칸과 다음 조각의 도달성을 사용해야 하고, 단순히 한쪽이 낮다는 이유로 LST라고 이름 붙이지 않는다.

## 밈과 룰 의존성

**Washing Machine**은 피스의 반복 회전을 보여주는 밈 시연을 뜻하는 맥락이다. [직접 게시된 시연](https://www.reddit.com/r/Tetris/comments/p0utpx/)은 찾았으나 단일 표준 오프너의 좌표·성공률·모든 게임에서의 가용성은 확정하지 않았다. 떠 있는 셀 주위 회전이라는 해석은 실행 fixture가 아니다. 실제로 넣으려면 준비 보드와 반복 회전 경로, 중력·lock reset·시간 제한을 함께 검증해야 한다. 별도의 공격 판정으로 만들지 않는다.

**Among Us**는 크루원 실루엣을 만드는 블록 아트/밈 맥락이다. [플레이어 본인의 시연 설명](https://www.youtube.com/watch?v=kbYAeAZRaaE)을 확인했다. 영상 뒤의 PC는 해당 모양이 PC를 보장한다는 근거가 아니다. 현재 canonical Fumen을 확보하지 않아 설명 레지스트리만 제공한다.

**Mechanical Hearts / Mechanical Heart**는 T 외의 스핀을 섞어 연쇄하는 All-spin 루프 계열이다. [정원의 직접 도해와 조작 설명](https://hse30.tistory.com/1251)은 S/L 스핀의 B2B 유지와 일부 180도 조작을 설명한다. 이 자료를 전 세계 모든 룰셋의 규칙으로 일반화하지 않았다. T-spin-only 룰에서는 의도한 보상 구조가 성립하지 않으므로 기본 비활성화한다. Mechanical TSD나 LST와 동일어로 취급하지 않는다. 특정 게임명보다 `non-T spin recognition`, `non-T spin B2B`, `180 kick profile` capability를 검사한다.

## 재현과 검증 결과

`node knowledge/validate.cjs` 통과: 출처/패턴/fixture 참조, ID 중복, 행 폭과 문자, 좌표의 원본 색 일치, 미검증 데이터 비활성화를 검사했다. `tetris-fumen@1.1.3`으로 36개 Fumen 129개 page, 54개 optional operation을 해독했다. 추가로 well 좌표·좌우 mask 반전, 스택 열 분할, LST 단계 mask의 원본 일치, ST 비교 도해가 LST 목표에 섞이지 않음을 검사했다. decoder의 `canLock`는 충돌·지지 여부만 확인한다. 스폰부터의 SRS 경로, T스핀 마지막 회전, 가방·hold 순서, top-out 여부는 이 조사 도구가 검증하지 않는다.

별도 임시 도구 환경의 `ajv@8.17.1`로 `catalog.schema.json`에 대한 JSON Schema 2020-12 검증도 통과했다 (`validateFormats: false`; 날짜는 구조 검증기에서 조사일과 비교). 이 도구를 production 의존성에 추가하지 않았다.

따라서 이 문서는 **출처 조사 및 좌표 해독 완료**, **게임 엔진 통합 검증 별도** 상태다. 실행용 파생 데이터에는 엔진 버전/룰셋/초기 보드/순서/입력 경로/예상 결과를 붙여야 한다. 원시 출처 fixture는 검증 편의상 수정하지 않는다.
