from bgpipeline.classify import CATEGORIES, apply_classification, classify, classify_problem
from bgpipeline.features import compute_features, features_from_view, longest_run
from bgpipeline.xgid import parse_xgid, view_from_counts

SEEDS = {
    "seed-001": "-b----E-C---eE---c-e----B-:0:0:1:31:0:0:0:7:10",
    "seed-002": "-b----E-C---eE---c-e----B-:0:0:1:63:0:0:0:7:10",
    "seed-003": "---BCCD-B-A--a-a-b-dcca---:0:0:1:00:2:1:0:7:10",
    "seed-004": "-b---BD-C---dD---c-cba--AA:0:0:1:43:0:0:0:7:10",
    "seed-005": "--ABCBB------------bcb-ba-:1:-1:-1:52:2:3:0:7:10",
}


def tags_for(xgid):
    return classify(compute_features(parse_xgid(xgid)))


def test_longest_run():
    assert longest_run([True, True, False, True, True, True]) == 3
    assert longest_run([]) == 0


def test_opening_features():
    f = compute_features(parse_xgid(SEEDS["seed-001"]))
    assert f["contact"] and f["pips_me"] == 167 and f["pip_diff"] == 0
    assert f["anchors_me"] == [24] and f["anchors_them"] == [1]
    assert f["n_plays"] == 16 and not f["can_hit"]
    assert f["position_class"] == "contact"


def test_seed_tags():
    assert tags_for(SEEDS["seed-001"]) == ["opening"]
    assert tags_for(SEEDS["seed-002"]) == ["opening"]
    assert tags_for(SEEDS["seed-003"]) == ["racing-cube"]
    t4 = tags_for(SEEDS["seed-004"])
    assert "early-game" in t4 and "hit-or-not" in t4
    assert tags_for(SEEDS["seed-005"]) == ["bearing-off"]


def test_back_game():
    v = view_from_counts({24: 2, 22: 2, 13: 4, 8: 3, 6: 4}, {19: 3, 20: 3, 21: 2, 18: 2, 17: 2, 12: 3})
    f = features_from_view(v, decision="checker", dice=(6, 1))
    assert f["anchors_me"] == [22, 24] and f["pip_diff"] < -40
    assert "back-game" in classify(f)


def test_blitz():
    v = view_from_counts({6: 2, 5: 2, 4: 2, 8: 3, 13: 4, 24: 2}, {12: 5, 17: 3, 19: 5}, their_bar=2)
    f = features_from_view(v, decision="checker", dice=(3, 1))
    assert f["home_points_me"] == 3 and f["bar_them"] == 2
    assert "blitz" in classify(f)


def test_ace_point_and_bearing_off_against_anchor():
    v = view_from_counts({6: 3, 5: 3, 4: 3, 3: 3, 2: 3}, {1: 2, 19: 4, 20: 4, 21: 3, 22: 2})
    f = features_from_view(v, decision="checker", dice=(6, 4))
    tags = classify(f)
    assert "ace-point-game" in tags and "bearing-off" in tags


def test_priming_game():
    v = view_from_counts({4: 2, 5: 2, 6: 2, 7: 2, 8: 2, 13: 3, 24: 2}, {1: 2, 12: 5, 17: 3, 19: 5})
    f = features_from_view(v, decision="checker", dice=(6, 5))
    assert f["prime_me"] == 5
    assert "priming-game" in classify(f)


def test_holding_and_cube():
    v = view_from_counts({20: 2, 13: 3, 8: 3, 6: 4, 5: 3}, {12: 3, 16: 2, 17: 3, 19: 4, 21: 3})
    f = features_from_view(v, decision="cube-double")
    tags = classify(f)
    assert "contact-cube" in tags and "holding-game" in tags


def test_every_problem_gets_a_tag_and_only_known_tags():
    for xgid in SEEDS.values():
        tags = tags_for(xgid)
        assert tags and all(t in CATEGORIES for t in tags)


def test_apply_classification_merge():
    problem = {"xgid": SEEDS["seed-003"], "categories": ["contact-cube"], "analysis": {"positionClass": "race"}}
    apply_classification(problem, merge=True)
    assert problem["categories"] == ["racing-cube", "contact-cube"]
    assert problem["features"]["position_class"] == "race"
    tags, feats = classify_problem(problem)
    assert tags == ["racing-cube"] and feats["contact"] is False
