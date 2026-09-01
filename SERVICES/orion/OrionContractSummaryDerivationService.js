'use strict';

function deriveContractSummaries(db, refreshedAt) {
  db.exec('DELETE FROM orion_contractor_fy2026_summary; DELETE FROM orion_buyer_fy2026_summary; DELETE FROM orion_recompete_fy2026;');

  db.prepare(`INSERT INTO orion_contractor_fy2026_summary (uei,federal_obligations,award_count,latest_action_date,refreshed_at)
    SELECT uei, COALESCE(SUM(obligation),0), COUNT(*), MAX(action_date_last), ?
    FROM orion_award_refresh_fy2026
    GROUP BY uei`).run(refreshedAt);

  // The table contract is PRIMARY KEY (uei,buyer_name). Therefore buyer rows
  // must be aggregated to exactly that grain. The prior implementation also
  // grouped by awarding_agency, which could emit two rows with the same PK when
  // one office name appeared under multiple agency labels in USAspending.
  // When agency evidence conflicts at the buyer grain, preserve the buyer facts
  // and leave agency UNKNOWN/null rather than inventing one agency label.
  db.prepare(`INSERT INTO orion_buyer_fy2026_summary (uei,buyer_name,agency,award_count,spend,refreshed_at)
    WITH buyer_rows AS (
      SELECT
        uei,
        COALESCE(NULLIF(awarding_office,''), NULLIF(awarding_sub_agency,''), NULLIF(awarding_agency,'')) AS buyer_name,
        NULLIF(awarding_agency,'') AS agency,
        obligation
      FROM orion_award_refresh_fy2026
    )
    SELECT
      uei,
      buyer_name,
      CASE WHEN COUNT(DISTINCT agency) = 1 THEN MAX(agency) ELSE NULL END AS agency,
      COUNT(*),
      COALESCE(SUM(obligation),0),
      ?
    FROM buyer_rows
    WHERE buyer_name IS NOT NULL
    GROUP BY uei, buyer_name`).run(refreshedAt);

  db.prepare(`INSERT INTO orion_recompete_fy2026 (uei,award_key,title,agency,recompete_date,value,refreshed_at)
    SELECT uei, award_key, COALESCE(NULLIF(description,''), award_id_piid), awarding_agency,
    COALESCE(NULLIF(pop_potential_end_date,''), pop_current_end_date), MAX(potential_total_value,current_total_value), ?
    FROM orion_award_refresh_fy2026
    WHERE COALESCE(NULLIF(pop_potential_end_date,''), NULLIF(pop_current_end_date,'')) IS NOT NULL`).run(refreshedAt);
}

module.exports = deriveContractSummaries;
module.exports.deriveContractSummaries = deriveContractSummaries;
