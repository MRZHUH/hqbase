-- Connected apps shows a user when an authorized application last exercised a
-- credential, which is the signal that decides whether an old authorization is
-- still worth keeping. The column is nullable and additive so the previous
-- Worker keeps serving requests against a migrated database, and a token that
-- has never authenticated a request stays NULL rather than pretending to have
-- been used at issuance.
ALTER TABLE oauthAccessToken ADD COLUMN lastUsedAt TEXT;
