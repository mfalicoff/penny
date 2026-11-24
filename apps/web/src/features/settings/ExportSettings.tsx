import { useMutation } from "@tanstack/react-query";
import { useId, useState, type ReactNode } from "react";
import { ACCOUNT_MESSAGES, download, entriesPath, fileSize, type DownloadedFile, type EntriesPeriod } from "../../api/account";
import { ApiError } from "../../api/client";
import { useToday } from "../../app/useToday";
import { useIsDemo } from "../../demo/demo";
import { Button, Card, cx } from "../../design/controls";
import { Icon, type IconName } from "../../design/Icon";
import { monthLabel } from "../households/model";
import { SectionTitle } from "./SectionTitle";
import { useSettingsLayout, type SettingsLayoutKind } from "./SettingsLayout";

// The desktop card lists short lines with a check; the phone card has rows with an icon and detail.
const INCLUDED: { icon: IconName; line: string; title: string; detail: string }[] = [
  { icon: "list", line: "Entries as CSV and JSON", title: "Entries", detail: "CSV for spreadsheets, and JSON" },
  { icon: "wallet", line: "Accounts, categories and schedules", title: "Accounts, categories and schedules", detail: "" },
  { icon: "people", line: "Households and trips you're in", title: "Households and trips", detail: "Shared expenses with everyone's share" },
  { icon: "receipt", line: "Receipts, as the original files", title: "Receipts", detail: "The original files" },
  { icon: "image", line: "Your name, picture and email", title: "Profile", detail: "Your name, picture and email" },
];

type Range = "month" | "year" | "all";

function describe(error: unknown): string {
  if (error instanceof ApiError) return error.status === 0 ? ACCOUNT_MESSAGES.offline : error.message || ACCOUNT_MESSAGES.exportFailed;
  return ACCOUNT_MESSAGES.exportFailed;
}

/**
 * Settings › Export data (MAZ-152, card `web-export-all`): the full export, one ZIP the server
 * prepares with everything that belongs to the person, then entries only as a CSV for this month,
 * this year or everything. The Activity page's export button downloads the same CSV for the period
 * it shows. The demo has no account and no server, so it has nothing to export.
 */
export function ExportSettings() {
  const demo = useIsDemo();
  const layout = useSettingsLayout();
  if (demo) {
    return (
      <>
        <SectionTitle>Export data</SectionTitle>
        <Card title="Export data">
          <p className="export__lead">You're exploring sample data in this tab. Nothing here is saved, so there's nothing to export.</p>
        </Card>
      </>
    );
  }
  return (
    <div className={cx("export", `export--${layout}`)}>
      <SectionTitle>Export data</SectionTitle>
      <FullExport layout={layout} />
      <EntriesExport />
      <p className="privacy-footer">
        <Icon name="lock-closed" size={14} />
        <span>The server prepares the ZIP and deletes it after you download it.</span>
      </p>
    </div>
  );
}

/** A panel with its own heading (the cards' `.ph h4`), not the small uppercase group title. */
function Panel({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section className="card export__panel" aria-labelledby={id}>
      <h2 id={id} className="export__title">
        {title}
      </h2>
      {children}
    </section>
  );
}

function FullExport({ layout }: { layout: SettingsLayoutKind }) {
  const [file, setFile] = useState<DownloadedFile | null>(null);
  const errorId = useId();
  const zip = useMutation({
    mutationKey: ["export", "all"],
    mutationFn: () => download("/api/export", "penny-export.zip"),
    onSuccess: setFile,
  });
  const host = window.location.host;
  return (
    <Panel title="All your data">
      <p className="export__lead">One ZIP file with everything on {host} that belongs to you.</p>
      {layout === "desktop" ? (
        <ul className="export__lines" aria-label="Included">
          {INCLUDED.map((item) => (
            <li key={item.icon}>
              <Icon name="checkmark" size={15} />
              {item.line}
            </li>
          ))}
        </ul>
      ) : (
        <ul className="export__included" aria-label="Included">
          {INCLUDED.map((item) => (
            <li key={item.icon}>
              <span className="export__included-icon" aria-hidden="true">
                <Icon name={item.icon} size={17} />
              </span>
              <span className="export__included-body">
                {item.title}
                {item.detail ? <span className="export__included-detail">{item.detail}</span> : null}
              </span>
              <Icon name="checkmark" size={17} label="Included" />
            </li>
          ))}
        </ul>
      )}
      <div className="export__download">
        <Button
          variant="primary"
          icon="arrow-down"
          busy={zip.isPending}
          aria-describedby={zip.isError ? errorId : undefined}
          onClick={() => {
            zip.mutate();
          }}
        >
          {zip.isPending ? "Preparing…" : "Download ZIP"}
        </Button>
        {file ? (
          <span className="export__file" role="status">
            <Icon name="document-text" size={15} />
            {`${file.name} · ${fileSize(file.size)} · ready`}
          </span>
        ) : null}
      </div>
      {zip.isError ? (
        <p className="field__error" id={errorId} role="alert">
          {describe(zip.error)}
        </p>
      ) : null}
    </Panel>
  );
}

function EntriesExport() {
  const today = useToday();
  const month = today.slice(0, 7);
  const year = today.slice(0, 4);
  const [range, setRange] = useState<Range>("all");
  const name = useId();
  const errorId = useId();
  const csv = useMutation({
    mutationKey: ["export", "entries"],
    mutationFn: (period: EntriesPeriod) => download(entriesPath(period), "penny-entries.csv"),
  });
  const options: { value: Range; label: string; detail?: string }[] = [
    { value: "month", label: "This month", detail: monthLabel(month) },
    { value: "year", label: "This year", detail: year },
    { value: "all", label: "Everything" },
  ];
  return (
    <Panel title="Entries only">
      <p className="export__lead">A CSV file you can open in a spreadsheet.</p>
      <fieldset className="export__ranges">
        <legend className="visually-hidden">Entries</legend>
        {options.map((option) => (
          <label key={option.value} className={cx("export__range", option.value === range && "export__range--on")}>
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={option.value === range}
              onChange={() => {
                setRange(option.value);
              }}
            />
            <span className="export__radio" aria-hidden="true" />
            <span className="export__range-label">{option.label}</span>
            {option.detail ? <span className="export__range-detail">{option.detail}</span> : null}
          </label>
        ))}
      </fieldset>
      <div className="export__download">
        <Button
          icon="arrow-down"
          busy={csv.isPending}
          aria-describedby={csv.isError ? errorId : undefined}
          onClick={() => {
            csv.mutate(range === "month" ? { month } : range === "year" ? { year } : null);
          }}
        >
          Download CSV
        </Button>
      </div>
      {csv.isError ? (
        <p className="field__error" id={errorId} role="alert">
          {describe(csv.error)}
        </p>
      ) : null}
    </Panel>
  );
}
