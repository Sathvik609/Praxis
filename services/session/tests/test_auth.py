from praxis_session.auth import verify


def test_only_the_three_accounts_sign_in():
    assert verify("Rinky", "example-password") == {"username": "rinky", "name": "Rinky", "initial": "R"}
    assert verify("shruthi", "example-password")["name"] == "Shruthi"
    assert verify("SATHVIK", "example-password")["initial"] == "S"
    assert verify("Rinky", "wrong") is None
    assert verify("rinky", "example-password") is None  # passwords are case-sensitive
    assert verify("someone", "example-password") is None


def test_login_endpoint_issues_a_token_and_me_reads_it(client):
    bad = client.post("/api/auth/login", json={"username": "Rinky", "password": "nope"})
    assert bad.status_code == 401 and bad.json()["ok"] is False
    r = client.post("/api/auth/login", json={"username": "Sathvik", "password": "example-password"})
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] and body["user"]["name"] == "Sathvik" and body["token"]
    me = client.get("/api/auth/me", headers={"Authorization": f"Bearer {body['token']}"})
    assert me.status_code == 200 and me.json()["user"]["username"] == "sathvik"
    assert client.get("/api/auth/me").status_code == 401
    out = client.post("/api/auth/logout", headers={"Authorization": f"Bearer {body['token']}"})
    assert out.json()["ok"]
    assert client.get("/api/auth/me", headers={"Authorization": f"Bearer {body['token']}"}).status_code == 401
