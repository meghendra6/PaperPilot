# Verification

Repository root에서 다음을 실행합니다.

```bash
cd research-workspace
npm run verify
```

Expected high-level result:

```text
Loaded 53 runtime modules without syntax/link errors.
25 contract regression tests pass.
Runtime bundle matches build-support/runtime.sha256.
Rebuilt XPI passes ZIP integrity and contains all required entries.
```

`build-support/runtime.sha256`는 reviewed source bundle의 integrity gate입니다. Runtime source를 변경하면 tests와 diff를 검토하고, 생성된 bundle hash를 의도적으로 갱신해야 합니다.

이 자동 검증은 Zotero GUI나 authenticated Codex/Claude/Gemini live run을 대신하지 않습니다. Release 전 manual 범위는 `IMPLEMENTATION_SPEC.ko.md`의 **25.3 Runtime acceptance**를 따릅니다.
