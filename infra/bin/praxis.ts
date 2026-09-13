#!/usr/bin/env node
import { App } from 'aws-cdk-lib'
import { buildPraxisApp } from '../lib/app.js'

const app = new App()
buildPraxisApp(app, {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION ?? 'us-west-2',
})
