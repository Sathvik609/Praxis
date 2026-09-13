import { App, Stack, type StackProps } from 'aws-cdk-lib'
import type { Construct } from 'constructs'

/**
 * One stack per component. All four are intentionally empty in Week 1 so `cdk synth` proves the
 * toolchain without touching an AWS account. Resources land here in W3 (tools), W5 (session/web).
 *
 *  PraxisData    DynamoDB (patients, prescriptions, sessions) + S3 (event logs, traces, reports, consented clips)
 *  PraxisTools   arm64 Lambda behind Bedrock AgentCore Gateway (prescription/therapist, patient-model) + Cognito
 *  PraxisWeb     S3 + CloudFront for the React app
 *  PraxisSession c8g EC2 from the COOL AMI, session service under systemd (NOT ECS), API Gateway rate limit, CloudWatch, SSM
 */
export class PraxisDataStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props)
  }
}

export class PraxisToolsStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props)
  }
}

export class PraxisWebStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props)
  }
}

export class PraxisSessionStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props)
  }
}

export interface PraxisStacks {
  data: PraxisDataStack
  tools: PraxisToolsStack
  web: PraxisWebStack
  session: PraxisSessionStack
}

export function buildPraxisApp(app: App, env?: StackProps['env']): PraxisStacks {
  const data = new PraxisDataStack(app, 'PraxisData', { env })
  const tools = new PraxisToolsStack(app, 'PraxisTools', { env })
  const web = new PraxisWebStack(app, 'PraxisWeb', { env })
  const session = new PraxisSessionStack(app, 'PraxisSession', { env })
  return { data, tools, web, session }
}
