# infra

AWS CDK (TypeScript). Four stacks: `PraxisData`, `PraxisTools`, `PraxisWeb`, `PraxisSession`. Empty in Week 1; `pnpm synth` must always succeed. Deploy is a single `pnpm cdk deploy --all` once resources land (not before W3).

```bash
pnpm install && pnpm test && pnpm synth
```
