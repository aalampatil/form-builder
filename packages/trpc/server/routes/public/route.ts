import { router } from "../../trpc";

// Respondent endpoints will use the versioned schema. The deleted legacy
// services cannot safely serve it. Do not expose incomplete form endpoints.
export const publicRouter = router({});
