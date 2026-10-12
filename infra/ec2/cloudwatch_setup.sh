#!/usr/bin/env bash
# CloudWatch observability for the Praxis EC2 box. Run in AWS CloudShell (AWS CLI only, uses the
# CloudShell user's credentials); idempotent, safe to re-run.
#
#   bash infra/ec2/cloudwatch_setup.sh <alarm-email> [--replace-profile]
#        [--instance i-...] [--region us-east-2] [--distribution <cloudfront-id>]
#
# 1. IAM role + instance profile `praxis-ec2-role` (CloudWatchAgentServerPolicy), attached to the
#    instance (running or stopped). CloudWatch permissions only.
#    An instance that already has a different profile is left alone unless --replace-profile.
# 2. Log group /praxis/session, 30-day retention.
# 3. SNS topic praxis-alarms with an email subscription (confirm the email AWS sends).
# 4. Alarms: heartbeat missing (service down or logs not shipping), CPU > 80 % for 15 min,
#    EC2 status check failed, agent fallbacks >= 5 in 15 min.
# 5. Dashboard `Praxis` from infra/ec2/cloudwatch/dashboard.json.
# 6. Logs Insights saved queries under Praxis/.
#
# Then on the laptop: infra/ec2/deploy.sh <host> --skip-web --cloudwatch  (installs the agent).
# Nothing here starts, stops or resizes the instance.
set -euo pipefail

EMAIL="${1:-}"
[[ "$EMAIL" == *@*.* ]] || { echo "usage: cloudwatch_setup.sh <alarm-email> [--replace-profile] [--instance ID] [--region R] [--distribution ID]" >&2; exit 2; }
shift
INSTANCE_ID=<instance-id>
REGION=us-east-2
DISTRIBUTION_ID=<cloudfront-id>
REPLACE_PROFILE=0
while [ $# -gt 0 ]; do
  case "$1" in
    --replace-profile) REPLACE_PROFILE=1 ;;
    --instance) INSTANCE_ID="${2:?}"; shift ;;
    --region) REGION="${2:?}"; shift ;;
    --distribution) DISTRIBUTION_ID="${2:?}"; shift ;;
    *) echo "unknown option $1" >&2; exit 2 ;;
  esac
  shift
done

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROLE=praxis-ec2-role
LOG_GROUP=/praxis/session
TOPIC_NAME=praxis-alarms
export AWS_PAGER=""
ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
echo "account $ACCOUNT_ID · region $REGION · instance $INSTANCE_ID"

echo "== 1/6 IAM role + instance profile $ROLE"
if ! aws iam get-role --role-name "$ROLE" >/dev/null 2>&1; then
  aws iam create-role --role-name "$ROLE" --description "Praxis EC2: CloudWatch agent" \
    --assume-role-policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"ec2.amazonaws.com"},"Action":"sts:AssumeRole"}]}' >/dev/null
  echo "created role $ROLE"
fi
aws iam attach-role-policy --role-name "$ROLE" --policy-arn arn:aws:iam::aws:policy/CloudWatchAgentServerPolicy
if ! aws iam get-instance-profile --instance-profile-name "$ROLE" >/dev/null 2>&1; then
  aws iam create-instance-profile --instance-profile-name "$ROLE" >/dev/null
  echo "created instance profile $ROLE"
fi
if ! aws iam get-instance-profile --instance-profile-name "$ROLE" --query 'InstanceProfile.Roles[].RoleName' --output text | grep -qx "$ROLE"; then
  aws iam add-role-to-instance-profile --instance-profile-name "$ROLE" --role-name "$ROLE"
fi
PROFILE_ARN="$(aws iam get-instance-profile --instance-profile-name "$ROLE" --query InstanceProfile.Arn --output text)"
read -r ASSOC_ID CURRENT_ARN <<<"$(aws ec2 describe-iam-instance-profile-associations --region "$REGION" \
  --filters "Name=instance-id,Values=$INSTANCE_ID" "Name=state,Values=associating,associated" \
  --query 'IamInstanceProfileAssociations[0].[AssociationId,IamInstanceProfile.Arn]' --output text)"
if [ "$CURRENT_ARN" = "$PROFILE_ARN" ]; then
  echo "instance already uses $ROLE"
elif [ "$ASSOC_ID" = "None" ] || [ -z "$ASSOC_ID" ]; then
  # A new profile can take a few seconds to become usable by EC2 (IAM propagation).
  for i in 1 2 3 4 5 6 7 8 9 10; do
    if aws ec2 associate-iam-instance-profile --region "$REGION" --instance-id "$INSTANCE_ID" \
         --iam-instance-profile "Name=$ROLE" >/dev/null 2>&1; then echo "attached $ROLE to $INSTANCE_ID"; break; fi
    [ "$i" = 10 ] && { echo "could not attach $ROLE to $INSTANCE_ID" >&2; exit 1; }
    sleep 6
  done
elif [ "$REPLACE_PROFILE" = 1 ]; then
  aws ec2 replace-iam-instance-profile-association --region "$REGION" --association-id "$ASSOC_ID" \
    --iam-instance-profile "Name=$ROLE" >/dev/null
  echo "replaced $CURRENT_ARN with $ROLE"
else
  echo "instance has another profile ($CURRENT_ARN); re-run with --replace-profile to swap it" >&2
  exit 1
fi

echo "== 2/6 log group $LOG_GROUP (30 days)"
aws logs create-log-group --region "$REGION" --log-group-name "$LOG_GROUP" 2>/dev/null || true
aws logs put-retention-policy --region "$REGION" --log-group-name "$LOG_GROUP" --retention-in-days 30

echo "== 3/6 SNS topic $TOPIC_NAME -> $EMAIL"
TOPIC_ARN="$(aws sns create-topic --region "$REGION" --name "$TOPIC_NAME" --query TopicArn --output text)"
if aws sns list-subscriptions-by-topic --region "$REGION" --topic-arn "$TOPIC_ARN" \
     --query 'Subscriptions[].Endpoint' --output text | tr '\t' '\n' | grep -qxF "$EMAIL"; then
  echo "already subscribed (confirm the AWS email if you have not)"
else
  aws sns subscribe --region "$REGION" --topic-arn "$TOPIC_ARN" --protocol email --notification-endpoint "$EMAIL" >/dev/null
  echo "subscription requested: confirm the email from AWS Notifications"
fi

echo "== 4/6 alarms"
ACTIONS=(--alarm-actions "$TOPIC_ARN" --ok-actions "$TOPIC_ARN")
# The service writes one EMF heartbeat a minute; no heartbeats for 10 minutes = the service is
# down/wedged or the CloudWatch agent stopped shipping. Missing data is breaching on purpose:
# this alarm also fires while the instance is stopped (see README: disable-alarm-actions).
aws cloudwatch put-metric-alarm --region "$REGION" --alarm-name praxis-heartbeat-missing \
  --alarm-description "Praxis service heartbeat missing (service down, or logs not shipping)" \
  --namespace Praxis --metric-name Heartbeat --dimensions Name=Service,Value=session \
  --statistic Sum --period 300 --evaluation-periods 2 --threshold 1 \
  --comparison-operator LessThanThreshold --treat-missing-data breaching "${ACTIONS[@]}"
aws cloudwatch put-metric-alarm --region "$REGION" --alarm-name praxis-cpu-high \
  --alarm-description "Praxis host CPU above 80% for 15 minutes" \
  --namespace AWS/EC2 --metric-name CPUUtilization --dimensions "Name=InstanceId,Value=$INSTANCE_ID" \
  --statistic Average --period 300 --evaluation-periods 3 --threshold 80 \
  --comparison-operator GreaterThanThreshold --treat-missing-data notBreaching "${ACTIONS[@]}"
aws cloudwatch put-metric-alarm --region "$REGION" --alarm-name praxis-status-check-failed \
  --alarm-description "Praxis EC2 instance or system status check failing" \
  --namespace AWS/EC2 --metric-name StatusCheckFailed --dimensions "Name=InstanceId,Value=$INSTANCE_ID" \
  --statistic Maximum --period 300 --evaluation-periods 2 --threshold 1 \
  --comparison-operator GreaterThanOrEqualToThreshold --treat-missing-data notBreaching "${ACTIONS[@]}"
aws cloudwatch put-metric-alarm --region "$REGION" --alarm-name praxis-agent-fallbacks \
  --alarm-description "Claude agent fell back to the rule coach 5+ times in 15 minutes (errors or daily cap)" \
  --namespace Praxis --metric-name AgentFallbacks --dimensions Name=Service,Value=session \
  --statistic Sum --period 900 --evaluation-periods 1 --threshold 5 \
  --comparison-operator GreaterThanOrEqualToThreshold --treat-missing-data notBreaching "${ACTIONS[@]}"
echo "4 alarms set"

echo "== 5/6 dashboard Praxis"
BODY="$(sed -e "s/\${REGION}/$REGION/g" -e "s/\${INSTANCE_ID}/$INSTANCE_ID/g" \
            -e "s/\${DISTRIBUTION_ID}/$DISTRIBUTION_ID/g" -e "s/\${ACCOUNT_ID}/$ACCOUNT_ID/g" \
            "$HERE/cloudwatch/dashboard.json")"
aws cloudwatch put-dashboard --region "$REGION" --dashboard-name Praxis --dashboard-body "$BODY" \
  --query DashboardValidationMessages --output text

echo "== 6/6 Logs Insights saved queries"
put_query() {  # name, query string; updates the existing definition of the same name
  local id
  id="$(aws logs describe-query-definitions --region "$REGION" --query-definition-name-prefix "$1" \
        --query "queryDefinitions[?name=='$1'].queryDefinitionId | [0]" --output text)"
  if [ "$id" = "None" ] || [ -z "$id" ]; then
    aws logs put-query-definition --region "$REGION" --name "$1" --log-group-names "$LOG_GROUP" --query-string "$2" >/dev/null
  else
    aws logs put-query-definition --region "$REGION" --query-definition-id "$id" --name "$1" --log-group-names "$LOG_GROUP" --query-string "$2" >/dev/null
  fi
  echo "query $1"
}
put_query "Praxis/Sessions" 'fields @timestamp, mode, exercise, source, duration_s, verified, unverified, fps, proc_p50_ms, proc_p95_ms, event_to_cue_p95_ms, stopped, perception_lost
| filter evt = "session_end"
| sort @timestamp desc
| limit 100'
put_query "Praxis/Safety and errors" 'fields @timestamp, evt, session, mode, exercise, action, rule, code, error
| filter evt in ["stop_rule", "therapist_flag", "perception_lost", "ws_error", "agent_error"]
| sort @timestamp desc
| limit 200'
put_query "Praxis/Agent runs" 'fields @timestamp, session, trigger, outcome, provider, model, transport, ms, first_action_ms, tool_calls, tokens, cost_usd_est
| filter evt = "agent_run"
| stats count(*) as runs, sum(cost_usd_est) as cost_usd, pct(first_action_ms, 95) as first_action_p95_ms by outcome, provider'

cat <<EOF

Done. Next:
  1. Confirm the SNS email sent to $EMAIL.
  2. Laptop: infra/ec2/deploy.sh <instance-dns> --skip-web --cloudwatch   (installs the agent)
  3. Verify: aws logs tail $LOG_GROUP --follow --region $REGION
             https://$REGION.console.aws.amazon.com/cloudwatch/home?region=$REGION#dashboards/dashboard/Praxis
EOF
