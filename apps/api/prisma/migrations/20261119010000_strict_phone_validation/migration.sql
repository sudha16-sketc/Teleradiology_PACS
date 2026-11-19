ALTER TABLE "Hospital" ADD COLUMN "phone" TEXT;

CREATE OR REPLACE FUNCTION axis_validate_phone_change() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.phone IS NOT DISTINCT FROM OLD.phone THEN
    RETURN NEW;
  END IF;

  IF NEW.phone IS NOT NULL AND NEW.phone <> '' AND NEW.phone !~ '^\+91[1-9][0-9]{9}$' THEN
    RAISE EXCEPTION 'Phone number must contain exactly 10 digits.' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "User_phone_format" ON "User";
CREATE TRIGGER "User_phone_format"
BEFORE INSERT OR UPDATE OF "phone" ON "User"
FOR EACH ROW EXECUTE FUNCTION axis_validate_phone_change();

DROP TRIGGER IF EXISTS "Hospital_phone_format" ON "Hospital";
CREATE TRIGGER "Hospital_phone_format"
BEFORE INSERT OR UPDATE OF "phone" ON "Hospital"
FOR EACH ROW EXECUTE FUNCTION axis_validate_phone_change();

DROP TRIGGER IF EXISTS "CompanySettings_phone_format" ON "CompanySettings";
CREATE TRIGGER "CompanySettings_phone_format"
BEFORE INSERT OR UPDATE OF "phone" ON "CompanySettings"
FOR EACH ROW EXECUTE FUNCTION axis_validate_phone_change();
