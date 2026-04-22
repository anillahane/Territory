DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM customer_pocket_mappings
        GROUP BY customer_id
        HAVING COUNT(*) > 1
    ) THEN
        RAISE EXCEPTION
            'Cannot enforce unique customer_id on customer_pocket_mappings while duplicate customer IDs exist';
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_mappings_customer_id_unique
ON customer_pocket_mappings (customer_id);
