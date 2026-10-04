// A fixture for the server-only walk: a page that reaches a client component through the alias and a relative import.
import { Meter } from "@/components/Meter";

import { Link } from "../components/Link";

export const Page = () => (
  <>
    <Meter />
    <Link />
  </>
);
