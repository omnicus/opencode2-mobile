# Third-party software

opencode2-mobile is distributed under the MIT license. Its dependencies retain their
own licenses and are not relicensed by this project.

The production dependency graph currently includes MIT, Apache-2.0, BSD,
ISC, MPL-2.0, Python-2.0, CC-BY-4.0, BlueOak-1.0.0, Unlicense, and compatible
dual-license terms. In particular:

- `lightningcss` and its platform package use MPL-2.0.
- `caniuse-lite` includes data under CC-BY-4.0.
- `node-forge` is available under its BSD-3-Clause option.

The lockfile pins the exact dependency graph. This file records the source
repository's license inventory; it is not a generated binary notice bundle.
Before distributing an application binary, generate and review the installed
inventory:

```sh
pnpm licenses list --prod
```

Include the required copyright, attribution, and license texts with the binary.
In particular, preserve the CC-BY-4.0 attribution for bundled `caniuse-lite`
data. Package license and notice files are available in the installed package
directories after `pnpm install`.
