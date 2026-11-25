-- [DATA-MESSAGE-DELIVERY] per-recipient delivery tracking (WhatsApp Cloud API statuses via webhook)
CREATE TABLE message_deliveries (
  id SERIAL PRIMARY KEY,
  message_id INTEGER NOT NULL REFERENCES messages(id),
  candidate_id INTEGER REFERENCES candidates(id),
  to_address TEXT NOT NULL,
  provider_message_id TEXT,
  status TEXT NOT NULL,          -- simulated | accepted | sent | delivered | read | failed
  error TEXT,
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_deliveries_provider ON message_deliveries (provider_message_id);
CREATE INDEX idx_deliveries_message ON message_deliveries (message_id);
