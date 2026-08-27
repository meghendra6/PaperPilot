# PaperPilot Research Workspace 0.3.0

PaperPilot Research Workspace는 기존 PaperPilot과 함께 설치하는 독립 companion add-on입니다. 기존 reader pane을 교체하지 않고 별도 Zotero item-pane section을 등록하며, Phase 1–3의 evidence, mastery, retrieval, reproducibility, cross-paper, citation, monitor 기능을 제공합니다.

## 주요 파일

- 구현 스펙: `docs/IMPLEMENTATION_SPEC.ko.md`
- application orchestration: `src/companion/service.ts`
- Zotero UI: `src/companion/view.ts`
- Zotero/process adapter: `src/companion/platform.ts`
- Phase 1–3 feature modules: `src/modules/`
- 검증 절차: `docs/VERIFICATION.md`

## Source representation

`src/**/*.ts`는 unminified CommonJS-compatible runtime module body입니다. Build는 `build-support/module-order.json`의 53개 module을 deterministic bundle로 조립합니다. 검토된 runtime hash는 `build-support/runtime.sha256`에 고정되어 있어 source 변경 후에는 tests와 code review를 거쳐 의도적으로 갱신해야 합니다.

## Build and verify

Node.js 20 이상과 `zip`/`unzip`이 필요합니다.

```bash
cd research-workspace
npm test
npm run build
npm run package
npm run verify
```

`npm run verify`는 다음을 수행합니다.

1. 53개 runtime module syntax/link 검사
2. 25개 contract regression test 실행
3. runtime bundle 재생성 및 reviewed SHA-256 확인
4. XPI 재패키징, ZIP integrity, required entry 및 Zotero install metadata 검사

Reviewed runtime SHA-256:

```text
294b9749f3bfe00a839d836a282d3d1dbe59df046db91c753bbf0a0763e88e0f
```

생성물:

```text
build/content/scripts/paperpilot-research-workspace.js
dist/paperpilot-research-workspace-0.3.0-rebuilt.xpi
```

생성된 XPI는 Zotero의 **Tools → Add-ons → Install Add-on From File**에서 설치할 수 있습니다. 실제 Zotero 및 authenticated CLI 검증 항목은 구현 스펙의 runtime acceptance 절을 따릅니다.

Zotero 10은 `applications.zotero.update_url`을 필수 install metadata로 검사합니다. Companion manifest는 repository release update manifest의 HTTPS URL을 포함하며, `npm run verify`는 최종 XPI 안의 이 필드를 직접 확인합니다.

## Integration note

이 package는 add-on ID `paperpilot-research-workspace@meghendra6`를 사용하는 독립 companion입니다. 원본 PaperPilot에 feature engine을 직접 통합할 때의 adapter 교체와 regression 조건은 구현 스펙의 **Original PaperPilot integration specification**에 정의되어 있습니다.

## License

AGPL-3.0-or-later. Repository root의 `LICENSE`와 copyright notice를 유지합니다.
