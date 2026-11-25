-- [MOD-AI-GATEWAY] which AI provider served each CV extraction, and the fallback trail
ALTER TABLE cv_jobs ADD COLUMN ai_provider TEXT;
ALTER TABLE cv_jobs ADD COLUMN ai_attempts TEXT;
