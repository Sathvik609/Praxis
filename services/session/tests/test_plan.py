"""Default day order and pain tiers (locked 23 Sep 2026). The tier is a rule in code, never a
diagnosis and never the coach's call."""

import pytest

from praxis_session.plan import DAY_ORDER, WEEKLY, day_plan, stricter, tier_for
from praxis_session.prescription import SEED_PRESCRIPTION


def test_tier_boundaries_are_0_3_full_4_6_gentle_7_up_rest():
    assert [tier_for(p) for p in (0, 1, 2, 3)] == ["full"] * 4
    assert [tier_for(p) for p in (4, 5, 6)] == ["gentle"] * 3
    assert [tier_for(p) for p in (7, 8, 10)] == ["rest"] * 3
    assert tier_for(-3) == "full" and tier_for(42) == "rest"  # clamped to 0-10


def test_a_stricter_therapist_stop_level_moves_the_rest_tier_down_never_up():
    strict = SEED_PRESCRIPTION.model_copy(deep=True)
    strict.stop_rules.pain_max = 5
    assert [tier_for(p, strict) for p in (3, 4, 5, 6)] == ["full", "gentle", "rest", "rest"]
    lax = SEED_PRESCRIPTION.model_copy(deep=True)
    lax.stop_rules.pain_max = 9
    assert tier_for(7, lax) == "rest"


def test_the_seed_stop_level_is_the_rest_tier():
    """Pain >= 7 at check-in is the rest tier and the pain stop rule: one number, one flag."""
    assert SEED_PRESCRIPTION.stop_rules.pain_max == 7


def test_stricter_picks_the_more_careful_tier():
    assert stricter("full", "gentle") == "gentle" and stricter("gentle", "full") == "gentle"
    assert stricter("gentle", "rest") == "rest" and stricter("full", "full") == "full"


def test_default_day_order_is_pendulum_front_side_cup_and_nhpt_is_weekly():
    assert DAY_ORDER == ("pendulum", "flexion", "abduction", "cup")
    assert WEEKLY == ("nhpt",)
    plan = day_plan(2)
    assert plan["tier"] == "full" and plan["therapist_flag"] is False and plan["rest_advice"] is None
    assert [i["id"] for i in plan["items"]] == list(DAY_ORDER)
    assert [i["order"] for i in plan["items"]] == [1, 2, 3, 4]
    assert [i["id"] for i in plan["weekly"]] == ["nhpt"]
    assert [i["id"] for i in plan["demo"]] == ["external_rotation", "internal_rotation"]
    assert all(i["self_ticked"] and not i["camera_verified"] for i in plan["demo"])
    assert plan["minutes"] == 15
    flexion = plan["items"][1]
    assert (flexion["target_deg"], flexion["hold_s"], flexion["reps"]) == (90.0, 3.0, 8)
    assert "fast" in plan["items"][3]["dose"]


def test_gentle_tier_reduces_dose_and_range_within_the_prescription():
    plan = day_plan(5)
    assert plan["tier"] == "gentle" and plan["therapist_flag"] is False
    by_id = {i["id"]: i for i in plan["items"]}
    assert list(by_id) == list(DAY_ORDER)  # same order, softer dose
    assert by_id["pendulum"]["reps"] == 8
    assert (by_id["flexion"]["hold_s"], by_id["flexion"]["reps"], by_id["flexion"]["target_deg"]) == (2.0, 6, 90.0)
    assert (by_id["abduction"]["target_deg"], by_id["abduction"]["hold_s"], by_id["abduction"]["reps"]) == (60.0, 2.0, 6)
    assert "fast" not in by_id["cup"]["dose"]
    assert "gentle" in plan["reason"].lower() and "5" in plan["reason"]
    for item in plan["items"]:
        assert item["target_deg"] <= item["ceiling_deg"]


def test_rest_tier_offers_nothing_and_flags_the_therapist():
    plan = day_plan(8)
    assert plan["tier"] == "rest"
    assert plan["items"] == [] and plan["weekly"] == [] and plan["demo"] == []
    assert plan["therapist_flag"] is True and plan["rest_advice"]
    assert "8" in plan["reason"]


def test_nhpt_is_only_offered_when_due():
    assert day_plan(1, nhpt_due=False)["weekly"] == []
    assert [i["id"] for i in day_plan(1, nhpt_due=True)["weekly"]] == ["nhpt"]


@pytest.mark.parametrize("pain", [0, 3, 4, 6])
def test_every_planned_item_is_camera_coached_and_every_demo_item_self_ticked(pain):
    plan = day_plan(pain)
    assert all(i["mode"] == "coached" for i in plan["items"] + plan["weekly"])
    assert all(i["mode"] == "demo" for i in plan["demo"])


def test_api_plan_returns_the_tiered_day(client):
    body = client.get("/api/plan?pain=5").json()
    assert body["tier"] == "gentle" and [i["id"] for i in body["items"]] == list(DAY_ORDER)
    assert client.get("/api/plan?pain=9").json()["items"] == []
    assert client.get("/api/plan").json()["tier"] == "full"
