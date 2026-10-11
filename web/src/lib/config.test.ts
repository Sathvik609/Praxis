import { deploymentLabel, processingPlace } from './config'

test.each(['localhost', '127.0.0.1', '::1', '[::1]'])('%s: frames stay on this device', (host) => {
  expect(processingPlace(host)).toBe('processed on this device, never stored')
})

test.each(['praxis-production.up.railway.app', 'praxis.example.org', '192.168.1.20'])('%s: frames go to the Praxis service', (host) => {
  expect(processingPlace(host)).toBe('processed on the Praxis service in memory, never stored')
})

test('defaults to the page host', () => {
  expect(processingPlace()).toBe(processingPlace(location.hostname))
})

test('DESIGN_PREVIEW is off outside the design build', async () => {
  const { DESIGN_PREVIEW } = await import('./config')
  expect(DESIGN_PREVIEW).toBe(false)
})

describe('deploymentLabel', () => {
  const cool = { status: 'ok', opencv_build: { version: '5.1.0-dev', cool: true, arch: 'aarch64', dnn: true, path: '/opt/cool/x' } }
  it('names AWS Graviton + COOL when the service reports the COOL build', () => {
    const d = deploymentLabel(cool, 'dl8xykmg8ki61.cloudfront.net')
    expect(d.title).toBe('Running on AWS Graviton · COOL OpenCV 5.1.0-dev')
    expect(d.sub).toMatch(/Bedrock and other AWS cloud services are off/)
    expect(d.sub).toMatch(/processed on the Praxis service in memory, never stored/)
  })
  it('says the laptop edge build when the service runs locally', () => {
    const d = deploymentLabel({ status: 'ok', opencv_version: '5.0.0' }, 'localhost')
    expect(d.title).toBe('Edge mode · this laptop')
    expect(d.sub).toMatch(/processed on this device, never stored/)
  })
  it('says a hosted build without claiming AWS when the build is not COOL', () => {
    const d = deploymentLabel({ status: 'ok', opencv_version: '5.0.0' }, 'praxis.up.railway.app')
    expect(d.title).toBe('Hosted review build · AWS cloud services off')
  })
  it('does not claim AWS before /health answers', () => {
    expect(deploymentLabel(undefined, 'dl8xykmg8ki61.cloudfront.net').title).not.toMatch(/AWS Graviton/)
  })
})
