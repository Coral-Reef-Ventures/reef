// For this repository's own type check and tests. A Next consumer has the same declaration from next/types/global.
declare module "*.module.css" {
  const classes: Record<string, string>;
  export default classes;
}
