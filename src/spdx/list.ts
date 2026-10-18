import exceptions from "../../data/spdx/3.29.0/exceptions.json" with {
  type: "json",
};
import licenses from "../../data/spdx/3.29.0/licenses.json" with {
  type: "json",
};

/** The SPDX License List vendored in `data/spdx/`. */
export const SPDX_LIST_VERSION = licenses.licenseListVersion;

/** Every license id on the list, deprecated ones included: they are still SPDX ids. */
export const LICENSE_IDS: ReadonlySet<string> = new Set(
  licenses.licenses.map((license) => license.licenseId),
);

/** License ids that are not deprecated: the only ones a fix suggests by itself. */
export const CURRENT_LICENSE_IDS: readonly string[] = licenses.licenses
  .filter((license) => !license.isDeprecatedLicenseId)
  .map((license) => license.licenseId);

export const EXCEPTION_IDS: ReadonlySet<string> = new Set(
  exceptions.exceptions.map((exception) => exception.licenseExceptionId),
);
