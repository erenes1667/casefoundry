const SCHEMA_VERSION = 2;
const S23_FE_ID = "samsung-galaxy-s23-fe-sm-s711";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

/**
 * Applies narrowly scoped catalog migrations without replacing user records.
 *
 * The S23 FE correction only touches the exact bundled revision that shipped
 * with the 9 mm corner radius. A user-edited radius is preserved.
 */
function migrateCatalog(input, seedPhones) {
  const data = clone(input);
  const currentVersion = Number(data.schemaVersion) || 1;
  if (currentVersion >= SCHEMA_VERSION) {
    return { data, changed: false, actions: [] };
  }

  const actions = [];
  const stored = data.phones?.find((phone) => phone.id === S23_FE_ID);
  const seed = seedPhones.find((phone) => phone.id === S23_FE_ID);

  if (
    stored &&
    seed &&
    stored.revision <= 4 &&
    stored.dimensions?.cornerRadius === 9
  ) {
    stored.dimensions.cornerRadius = seed.dimensions.cornerRadius;
    stored.revision = seed.revision;
    stored.validation = {
      ...stored.validation,
      geometry: seed.validation.geometry,
      slice: seed.validation.slice,
      lastChecked: seed.validation.lastChecked,
    };
    stored.notes = seed.notes;
    stored.updatedAt = seed.updatedAt;
    actions.push({
      action: "s23fe_fit_geometry_updated",
      summary: "Updated Galaxy S23 FE body corner radius from 9 mm to 11 mm",
    });
  }

  data.schemaVersion = SCHEMA_VERSION;
  actions.push({
    action: "database_schema_migrated",
    summary: `Migrated the local catalog to schema ${SCHEMA_VERSION}`,
  });
  return { data, changed: true, actions };
}

module.exports = { SCHEMA_VERSION, migrateCatalog };
