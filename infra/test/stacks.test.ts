import { App } from 'aws-cdk-lib'
import { Template } from 'aws-cdk-lib/assertions'
import { describe, expect, it } from 'vitest'
import { buildPraxisApp } from '../lib/app.js'

describe('Praxis CDK app', () => {
  it('synthesizes one stack per component', () => {
    const app = new App()
    const stacks = buildPraxisApp(app)
    expect(Object.keys(stacks).sort()).toEqual(['data', 'session', 'tools', 'web'])
    expect(stacks.data.stackName).toBe('PraxisData')
    expect(stacks.tools.stackName).toBe('PraxisTools')
    expect(stacks.web.stackName).toBe('PraxisWeb')
    expect(stacks.session.stackName).toBe('PraxisSession')
    for (const s of Object.values(stacks)) {
      // Empty by design in Week 1: synth must succeed with no resources.
      expect(() => Template.fromStack(s)).not.toThrow()
    }
  })
})
