BEGIN;

DO $$
BEGIN
    IF current_database() <> 'footwear_omnichannel_test' THEN
        RAISE EXCEPTION 'Wrong database';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM "Location"
        WHERE code = 'M111_TEST_BRANCH_B'
          AND type = 'BRANCH'
          AND active = true
    ) THEN
        RAISE EXCEPTION 'M111 Branch B is missing or inactive';
    END IF;

    IF EXISTS (
        SELECT 1 FROM "Location"
        WHERE code = 'M112_POS_BRANCH_A'
    ) THEN
        RAISE EXCEPTION 'M112 fixtures already exist';
    END IF;

    IF EXISTS (
        SELECT 1 FROM "User"
        WHERE email IN (
            'm112-cashier-a@localhost.invalid',
            'm112-cashier-b@localhost.invalid',
            'm112-manager-a@localhost.invalid',
            'm112-manager-b@localhost.invalid'
        )
    ) THEN
        RAISE EXCEPTION 'M112 test users already exist';
    END IF;

    IF EXISTS (
        SELECT 1 FROM "Role"
        WHERE code IN ('CASHIER', 'BRANCH_MANAGER')
    ) THEN
        RAISE EXCEPTION 'POS roles already exist; inspect before retrying';
    END IF;

    IF EXISTS (
        SELECT 1 FROM "PosDevice"
        WHERE code IN ('M112_POS_A', 'M112_POS_B')
    ) THEN
        RAISE EXCEPTION 'M112 POS devices already exist';
    END IF;
END $$;

INSERT INTO "Role" (id, code, name)
VALUES
    (:'roleCashier'::uuid, 'CASHIER', 'Cashier'),
    (:'roleManager'::uuid, 'BRANCH_MANAGER', 'Branch Manager');

INSERT INTO "Location"
    (id, code, name, type, active, "updatedAt")
VALUES
    (
        :'branchA'::uuid,
        'M112_POS_BRANCH_A',
        'M112 Synthetic POS Branch A',
        'BRANCH',
        true,
        CURRENT_TIMESTAMP
    );

INSERT INTO "User"
    (id, email, name, "passwordHash", status, "updatedAt")
VALUES
    (:'cashierA'::uuid, 'm112-cashier-a@localhost.invalid',
     'M112 Cashier A', :'passwordHash', 'ACTIVE', CURRENT_TIMESTAMP),

    (:'cashierB'::uuid, 'm112-cashier-b@localhost.invalid',
     'M112 Cashier B', :'passwordHash', 'ACTIVE', CURRENT_TIMESTAMP),

    (:'managerA'::uuid, 'm112-manager-a@localhost.invalid',
     'M112 Manager A', :'passwordHash', 'ACTIVE', CURRENT_TIMESTAMP),

    (:'managerB'::uuid, 'm112-manager-b@localhost.invalid',
     'M112 Manager B', :'passwordHash', 'ACTIVE', CURRENT_TIMESTAMP);

INSERT INTO "UserRole" ("userId", "roleId")
VALUES
    (:'cashierA'::uuid, :'roleCashier'::uuid),
    (:'cashierB'::uuid, :'roleCashier'::uuid),
    (:'managerA'::uuid, :'roleManager'::uuid),
    (:'managerB'::uuid, :'roleManager'::uuid);

INSERT INTO "UserLocation" ("userId", "locationId")
VALUES
    (:'cashierA'::uuid, :'branchA'::uuid),
    (:'managerA'::uuid, :'branchA'::uuid);

INSERT INTO "UserLocation" ("userId", "locationId")
SELECT :'cashierB'::uuid, id
FROM "Location"
WHERE code = 'M111_TEST_BRANCH_B';

INSERT INTO "UserLocation" ("userId", "locationId")
SELECT :'managerB'::uuid, id
FROM "Location"
WHERE code = 'M111_TEST_BRANCH_B';

INSERT INTO "PosDevice" (id, code, "locationId", active)
VALUES
    (:'deviceA'::uuid, 'M112_POS_A', :'branchA'::uuid, true);

INSERT INTO "PosDevice" (id, code, "locationId", active)
SELECT :'deviceB'::uuid, 'M112_POS_B', id, true
FROM "Location"
WHERE code = 'M111_TEST_BRANCH_B';

COMMIT;
