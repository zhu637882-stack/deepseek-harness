# Agent Note: Preserve projects through additive director method updates

Status: implemented

## Problem and decision

Asset design reads for existing projects failed with `creative_contract_director_skill_catalog_stale` after the packaged director gained camera guidance and whole-cut sound review. Source hashes were updated, but predecessor declarations still targeted the earlier method. The source manifest declares the reviewed released revisions as compatible with the current exact method. Frozen project settings and media remain unchanged.

## Verification and limits

The packaged-source regression requires every compatibility declaration to target the installed method and retain known released project references. Writer continues rejecting undeclared changes; compatibility is not a wildcard version bypass. Browser recovery exercises existing projects without migration or generation. Future method updates must review compatibility alongside their source hashes.
