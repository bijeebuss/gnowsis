-- Add IVFFlat index for fast vector similarity search
-- This index enables approximate nearest neighbor (ANN) search on the dense_vector column
-- Lists parameter (100) creates 100 clusters - adjust based on data size:
-- - Small datasets (<10K vectors): lists = 100
-- - Medium datasets (10K-100K vectors): lists = sqrt(total_vectors)
-- - Large datasets (>100K vectors): lists = sqrt(total_vectors) or higher

-- Create IVFFlat index on dense vectors for L2 distance operations
CREATE INDEX IF NOT EXISTS vectors_dense_vector_ivfflat_idx
ON vectors
USING ivfflat (dense_vector vector_l2_ops)
WITH (lists = 100);

-- Note: After creating this index, you may want to run ANALYZE to update statistics:
-- ANALYZE vectors;
