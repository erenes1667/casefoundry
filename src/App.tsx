import {
  Activity,
  ArrowRight,
  Box,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  Copy,
  Database,
  Download,
  ExternalLink,
  FileArchive,
  FolderOpen,
  Gauge,
  HardDrive,
  Import,
  Info,
  Layers3,
  LayoutDashboard,
  LoaderCircle,
  Menu,
  PackageCheck,
  Palette,
  Plus,
  Printer,
  RotateCcw,
  Ruler,
  Save,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Smartphone,
  Sparkles,
  Trash2,
  Upload,
  WandSparkles,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { CasePreview } from "./components/CasePreview";
import { PhoneDiagram } from "./components/PhoneDiagram";
import {
  architectures,
  defaultConfiguration,
  materials,
  patterns,
  printProfiles,
} from "./data/catalog";
import {
  generateCase,
  generateFitCoupon,
  geometryBounds,
  printableFileStem,
  ensureEngineReady,
  printerFor,
  recipeForConfiguration,
  serializeCase3mf,
  serializeCaseStl,
  tuneConfiguration,
  validateCase,
} from "./lib/caseEngine";
import { defaultFilamentFor } from "./data/filaments";
import { PRINTERS } from "./lib/bambuProject";
import { parsePhonePack, phonePackCsv } from "./lib/catalogImport";
import { bytesToBase64, humanDate, statusLabel } from "./lib/format";
import type {
  AppInfo,
  CaseConfiguration,
  CaseProject,
  FeatureKind,
  FeatureShape,
  FeatureSide,
  GeneratedCase,
  MaterialId,
  PatternId,
  PhoneFeature,
  PhoneRecord,
  ValidationIssue,
  VerificationStatus,
} from "./types";

type ViewId =
  | "dashboard"
  | "studio"
  | "phones"
  | "measure"
  | "quality"
  | "designs"
  | "profiles"
  | "settings";

interface ToastState {
  kind: "success" | "error" | "info";
  title: string;
  detail?: string;
}

interface RegressionResult {
  phoneId: string;
  passed: boolean;
  polygons: number;
  bytes: number;
  detail: string;
}

const navItems: Array<{ id: ViewId; label: string; icon: typeof Box }> = [
  { id: "dashboard", label: "Overview", icon: LayoutDashboard },
  { id: "studio", label: "Case Studio", icon: Box },
  { id: "phones", label: "Phone Database", icon: Database },
  { id: "measure", label: "Measurement Lab", icon: Ruler },
  { id: "quality", label: "Quality Center", icon: ShieldCheck },
  { id: "designs", label: "Design Library", icon: Palette },
  { id: "profiles", label: "Print Profiles", icon: Printer },
  { id: "settings", label: "Settings", icon: Settings2 },
];

const statusOptions: VerificationStatus[] = [
  "production-ready",
  "fit-validated",
  "reference-derived",
  "measured",
  "sourced",
  "compatibility-candidate",
  "provisional",
];

const featureKinds: FeatureKind[] = [
  "camera",
  "cameraIsland",
  "flash",
  "button",
  "port",
  "speaker",
  "microphone",
  "simTray",
  "sPen",
  "coil",
  "antenna",
  "other",
];

const featureSides: FeatureSide[] = [
  "back",
  "screen",
  "screenLeft",
  "screenRight",
  "top",
  "bottom",
];

const featureShapes: FeatureShape[] = ["circle", "slot", "rect", "roundedRect"];

function waitForPaint() {
  return new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
}

function freshPhone(): PhoneRecord {
  const now = new Date().toISOString();
  return {
    id: `phone-${Date.now()}`,
    brand: "",
    model: "",
    variant: "",
    modelNumbers: [],
    chassisFamily: "",
    releaseYear: new Date().getFullYear(),
    revision: 1,
    status: "provisional",
    confidence: 20,
    dimensions: { width: 75, length: 158, depth: 8, cornerRadius: 9 },
    features: [],
    sources: [],
    validation: { geometry: "not-run", slice: "not-run", physicalFit: "not-tested" },
    tags: ["draft"],
    notes: "New record. Add sources and hardware measurements before export.",
    createdAt: now,
    updatedAt: now,
  };
}

function freshFeature(): PhoneFeature {
  return {
    id: `feature-${Date.now()}`,
    name: "New feature",
    kind: "button",
    side: "screenRight",
    shape: "slot",
    center: { x: 0, y: 0, z: 4 },
    size: { x: 1.2, y: 14, z: 3 },
    confidence: 25,
  };
}

function StatusPill({ status }: { status: VerificationStatus }) {
  return <span className={`status-pill status-${status}`}>{statusLabel(status)}</span>;
}

function Confidence({ value }: { value: number }) {
  return (
    <span className="confidence" title={`${value}% confidence`}>
      <span style={{ width: `${value}%` }} />
      <b>{value}%</b>
    </span>
  );
}

function PageHeader({
  eyebrow,
  title,
  subtitle,
  actions,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
  actions?: React.ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}

function MetricCard({
  label,
  value,
  detail,
  icon: Icon,
  tone = "green",
}: {
  label: string;
  value: string | number;
  detail: string;
  icon: typeof Box;
  tone?: "green" | "blue" | "amber" | "violet";
}) {
  return (
    <article className={`metric-card tone-${tone}`}>
      <div className="metric-icon"><Icon size={19} /></div>
      <div><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>
    </article>
  );
}

function PatternSwatch({ pattern }: { pattern: PatternId }) {
  if (pattern === "none") return <div className="pattern-swatch plain"><span /></div>;
  if (pattern === "sakura") {
    return (
      <div className="pattern-swatch">
        <svg viewBox="0 0 120 80">
          {[25, 60, 95].map((cx, flower) => (
            <g key={cx} transform={`translate(${cx} ${flower % 2 ? 31 : 43})`}>
              {[0, 72, 144, 216, 288].map((angle) => (
                <ellipse key={angle} rx="5" ry="11" transform={`rotate(${angle}) translate(0 -9)`} />
              ))}
              <circle r="4" />
            </g>
          ))}
        </svg>
      </div>
    );
  }
  if (pattern === "asanoha") {
    return (
      <div className="pattern-swatch">
        <svg viewBox="0 0 120 80">
          <g transform="translate(60 40)">
            {[0, 60, 120, 180, 240, 300].map((angle) => (
              <g key={angle} transform={`rotate(${angle})`}>
                <path d="M0 0 L0 -28 M0 -14 L14 -24 M0 -14 L-14 -24" />
              </g>
            ))}
          </g>
        </svg>
      </div>
    );
  }
  if (pattern === "circuit") {
    return (
      <div className="pattern-swatch">
        <svg viewBox="0 0 120 80">
          <path d="M8 18 H48 V31 H82 V16 H110 M8 42 H32 V58 H74 V45 H110 M22 72 V66 H94 V59" />
          <g>{[[8,18],[110,16],[8,42],[110,45],[22,72],[94,59]].map(([x,y]) => <circle key={`${x}-${y}`} cx={x} cy={y} r="3" />)}</g>
        </svg>
      </div>
    );
  }
  return (
    <div className="pattern-swatch">
      <svg viewBox="0 0 120 80">
        <path d="M9 39 C12 11 45 6 72 13 C103 20 115 43 102 61 C89 79 48 76 24 64 C12 58 7 50 9 39Z" />
        <path d="M20 40 C23 21 47 16 69 21 C91 26 103 41 93 55 C82 68 52 66 34 58 C24 53 18 47 20 40Z" />
        <path d="M34 41 C37 29 52 27 66 30 C80 33 87 42 81 50 C74 58 56 57 45 52 C38 49 33 45 34 41Z" />
      </svg>
    </div>
  );
}

function IssueRow({ issue }: { issue: ValidationIssue }) {
  const Icon = issue.severity === "pass" ? CircleCheck : issue.severity === "error" ? CircleAlert : Info;
  return (
    <div className={`issue-row issue-${issue.severity}`}>
      <Icon size={17} />
      <div><strong>{issue.title}</strong><span>{issue.detail}</span></div>
    </div>
  );
}

export function App() {
  const [view, setView] = useState<ViewId>("dashboard");
  const [sidebarCompact, setSidebarCompact] = useState(false);
  const [phones, setPhones] = useState<PhoneRecord[]>([]);
  const [projects, setProjects] = useState<CaseProject[]>([]);
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [selectedPhoneId, setSelectedPhoneId] = useState("");
  const [configuration, setConfiguration] = useState<CaseConfiguration>(() => defaultConfiguration(""));
  const [generated, setGenerated] = useState<GeneratedCase | null>(null);
  const [generatedSignature, setGeneratedSignature] = useState("");
  const [building, setBuilding] = useState(false);
  const [previewView, setPreviewView] = useState<"exterior" | "phone">("exterior");
  const [toast, setToast] = useState<ToastState | null>(null);
  const [editingPhone, setEditingPhone] = useState<PhoneRecord | null>(null);
  const [selectedFeatureId, setSelectedFeatureId] = useState("");
  const [regressions, setRegressions] = useState<RegressionResult[]>([]);
  const [regressionRunning, setRegressionRunning] = useState(false);
  const bootGenerated = useRef(false);

  const selectedPhone = useMemo(
    () => phones.find((phone) => phone.id === selectedPhoneId) ?? phones[0] ?? null,
    [phones, selectedPhoneId],
  );
  const signature = useMemo(
    () => JSON.stringify([configuration, selectedPhone?.updatedAt]),
    [configuration, selectedPhone?.updatedAt],
  );
  const stale = generatedSignature !== signature;
  const validation = useMemo(
    () => selectedPhone ? validateCase(selectedPhone, configuration) : null,
    [selectedPhone, configuration],
  );

  useEffect(() => {
    Promise.all([
      window.casefoundry.listPhones(),
      window.casefoundry.listProjects(),
      window.casefoundry.appInfo(),
    ])
      .then(([loadedPhones, loadedProjects, info]) => {
        setPhones(loadedPhones);
        setProjects(loadedProjects);
        setAppInfo(info);
        if (loadedPhones[0]) {
          setSelectedPhoneId(loadedPhones[0].id);
          setEditingPhone(structuredClone(loadedPhones[0]));
          setConfiguration(tuneConfiguration(loadedPhones[0], defaultConfiguration(loadedPhones[0].id)));
        }
      })
      .catch((error: Error) => setToast({ kind: "error", title: "Could not open the local catalog", detail: error.message }));
  }, []);

  // Backstop for any promise rejection that is not individually handled.
  // Several save paths are invoked as `void save()`, so without this a rejected
  // IPC call (including every ValidationError from the main process) vanished
  // silently and the user believed their edit had been written.
  useEffect(() => {
    const onRejection = (event: PromiseRejectionEvent) => {
      event.preventDefault();
      const reason = event.reason;
      setToast({
        kind: "error",
        title: "Operation failed",
        detail:
          reason instanceof Error
            ? reason.message
            : String(reason ?? "Unknown error"),
      });
    };
    window.addEventListener("unhandledrejection", onRejection);
    return () => window.removeEventListener("unhandledrejection", onRejection);
  }, []);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(null), 4800);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!selectedPhone || bootGenerated.current) return;
    bootGenerated.current = true;
    const timer = window.setTimeout(() => {
      void ensureEngineReady().then(() => {
      try {
        const built = generateCase(selectedPhone, configuration);
        setGenerated(built);
        setGeneratedSignature(JSON.stringify([configuration, selectedPhone.updatedAt]));
      } catch (error) {
        setToast({ kind: "error", title: "Initial geometry failed", detail: (error as Error).message });
      }
      });
    }, 80);
    return () => window.clearTimeout(timer);
  }, [selectedPhone, configuration]);

  const notify = (next: ToastState) => setToast(next);

  /**
   * Selects a record we already hold, without looking it up in `phones`.
   *
   * After an import or reset, `phones` in this closure is still the previous
   * list, so any id-based lookup silently finds nothing and the selection
   * quietly does not change.
   */
  const selectPhoneRecord = (phone: PhoneRecord, preserveDesign = true) => {
    setSelectedPhoneId(phone.id);
    setEditingPhone(structuredClone(phone));
    setSelectedFeatureId("");
    const base = preserveDesign
      ? { ...configuration, phoneId: phone.id }
      : defaultConfiguration(phone.id);
    setConfiguration(tuneConfiguration(phone, base));
  };

  const choosePhone = (phoneId: string, preserveDesign = true) => {
    const phone = phones.find((entry) => entry.id === phoneId);
    if (!phone) return;
    setSelectedPhoneId(phone.id);
    setEditingPhone(structuredClone(phone));
    setSelectedFeatureId("");
    const base = preserveDesign ? { ...configuration, phoneId: phone.id } : defaultConfiguration(phone.id);
    setConfiguration(tuneConfiguration(phone, base));
  };

  const patchConfiguration = (patch: Partial<CaseConfiguration>) => {
    if (!selectedPhone) return;
    setConfiguration((current) => ({ ...current, ...patch, phoneId: selectedPhone.id }));
  };

  const changeMaterial = (material: MaterialId) => {
    if (!selectedPhone) return;
    const next = tuneConfiguration(selectedPhone, { ...configuration, material });
    setConfiguration(next);
  };

  const buildGeometry = async (
    phone = selectedPhone,
    config = configuration,
    quiet = false,
  ): Promise<GeneratedCase | null> => {
    if (!phone) return null;
    setBuilding(true);
    try {
      // These were outside the try. If the geometry kernel failed to load, the
      // throw escaped before `finally` existed and `building` stayed true, so
      // the Studio locked up permanently with no error shown.
      await ensureEngineReady();
      await waitForPaint();
      const next = generateCase(phone, config);
      setGenerated(next);
      setGeneratedSignature(JSON.stringify([config, phone.updatedAt]));
      if (!quiet) {
        notify({
          kind: next.report.printable ? "success" : "error",
          title: next.report.printable ? "Geometry passed preflight" : "Geometry built with blocking issues",
          detail: `${next.report.metrics.polygonCount?.toLocaleString()} polygons · ${next.report.score}/100 DFM score`,
        });
      }
      return next;
    } catch (error) {
      notify({ kind: "error", title: "Geometry generation failed", detail: (error as Error).message });
      return null;
    } finally {
      setBuilding(false);
    }
  };

  const ensureFresh = async () => {
    if (generated && !stale) return generated;
    return buildGeometry(selectedPhone, configuration, true);
  };

  const exportPrintable = async (format: "stl" | "3mf") => {
    const built = await ensureFresh();
    if (!built || !selectedPhone) return;
    const hasInlay = built.parts.some((part) => part.role === "inlay");
    if (!built.report.printable) {
      notify({ kind: "error", title: "Export blocked by preflight", detail: "Resolve the red DFM checks before exporting printable geometry." });
      return;
    }
    if (format === "stl" && hasInlay) {
      notify({
        kind: "error",
        title: "Two-material artwork requires 3MF",
        detail: "Use Export 3MF so the translucent shell and opaque inlay keep their separate filament assignments.",
      });
      return;
    }
    try {
      const filament = defaultFilamentFor(configuration.material);
      const inlayFilament =
        hasInlay
          ? defaultFilamentFor("petg")
          : undefined;
      if (format === "3mf" && !filament) {
        notify({
          kind: "error",
          title: "No filament profile for this material",
          detail:
            "Install Bambu Studio and rebuild the filament catalog, or export STL instead. " +
            "Refusing to write a project with invented print settings.",
        });
        return;
      }
      const bytes =
        format === "stl"
          ? serializeCaseStl(built)
          : serializeCase3mf(built, {
              filament: { ...filament!, colour: configuration.color },
              inlayFilament: inlayFilament
                ? { ...inlayFilament, colour: "#202020" }
                : undefined,
              recipe: recipeForConfiguration(configuration),
              phone: selectedPhone,
              date: new Date().toISOString().slice(0, 10),
              printer: printerFor(configuration),
            });
      const stem = printableFileStem(selectedPhone, configuration);
      const result = await window.casefoundry.saveBinaryFile({
        title: `Export ${format.toUpperCase()} geometry`,
        defaultName: `${stem}.${format}`,
        base64: bytesToBase64(bytes),
        filters: [{ name: format === "stl" ? "STL mesh" : "3MF manufacturing model", extensions: [format] }],
      });
      if (!result.canceled) {
        notify({ kind: "success", title: `${format.toUpperCase()} exported`, detail: `${result.bytes?.toLocaleString()} bytes written to ${result.path}` });
      }
    } catch (error) {
      notify({ kind: "error", title: "Export failed", detail: (error as Error).message });
    }
  };

  const exportFitCoupon = async () => {
    if (!selectedPhone) return;
    setBuilding(true);
    try {
      await ensureEngineReady();
      await waitForPaint();
      const coupon = generateFitCoupon(selectedPhone, configuration);
      if (!coupon.report.printable) {
        notify({ kind: "error", title: "Coupon export blocked", detail: "Resolve the current material and geometry errors first." });
        return;
      }
      const couponFilament = defaultFilamentFor(configuration.material);
      if (!couponFilament) {
        notify({
          kind: "error",
          title: "No filament profile for this material",
          detail: "Install Bambu Studio and rebuild the filament catalog first.",
        });
        return;
      }
      const bytes = serializeCase3mf(coupon, {
        filament: couponFilament,
        recipe: recipeForConfiguration(configuration),
        phone: selectedPhone,
        date: new Date().toISOString().slice(0, 10),
        printer: printerFor(configuration),
      });
      const result = await window.casefoundry.saveBinaryFile({
        title: "Export fit coupon set",
        defaultName: `${printableFileStem(selectedPhone, configuration)}-FIT-COUPONS.3mf`,
        base64: bytesToBase64(bytes),
        filters: [{ name: "3MF fit coupon set", extensions: ["3mf"] }],
      });
      if (!result.canceled) notify({ kind: "success", title: "Fit coupon set exported", detail: "Camera, control-side, and bottom-port samples are ready for a short test print." });
    } catch (error) {
      notify({ kind: "error", title: "Coupon generation failed", detail: (error as Error).message });
    } finally {
      setBuilding(false);
    }
  };

  const saveProject = async () => {
    if (!selectedPhone || !validation) return;
    const project: CaseProject = {
      id: `project-${selectedPhone.id}-${Date.now()}`,
      name: `${selectedPhone.model} · ${patterns[configuration.pattern].name}`,
      phoneId: selectedPhone.id,
      configuration,
      validation,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const saved = await window.casefoundry.saveProject(project);
    setProjects((current) => [saved, ...current]);
    notify({ kind: "success", title: "Project saved", detail: saved.name });
  };

  const openMeasurement = (phone?: PhoneRecord) => {
    const target = phone ?? selectedPhone ?? freshPhone();
    setEditingPhone(structuredClone(target));
    if (phones.some((entry) => entry.id === target.id)) setSelectedPhoneId(target.id);
    setSelectedFeatureId(target.features[0]?.id ?? "");
    setView("measure");
  };

  const saveMeasurement = async () => {
    if (!editingPhone) return;
    if (!editingPhone.brand.trim() || !editingPhone.model.trim()) {
      notify({ kind: "error", title: "Brand and model are required" });
      return;
    }
    if (Object.values(editingPhone.dimensions).some((value) => value <= 0)) {
      notify({ kind: "error", title: "Body dimensions must be positive" });
      return;
    }
    const saved = await window.casefoundry.savePhone(editingPhone);
    setPhones((current) => {
      const exists = current.some((phone) => phone.id === saved.id);
      return exists ? current.map((phone) => phone.id === saved.id ? saved : phone) : [saved, ...current];
    });
    setSelectedPhoneId(saved.id);
    setEditingPhone(structuredClone(saved));
    setConfiguration((current) => ({ ...current, phoneId: saved.id }));
    notify({ kind: "success", title: "Phone revision saved", detail: `${saved.brand} ${saved.model} · revision ${saved.revision}` });
  };

  const importPhonePack = async () => {
    try {
      const opened = await window.casefoundry.openTextFile([
        { name: "CaseFoundry phone pack", extensions: ["json", "csv"] },
      ]);
      if (opened.canceled || !opened.text) return;
      const records = parsePhonePack(opened.text, opened.name);
      const saved = await window.casefoundry.savePhones(records);
      setPhones(await window.casefoundry.listPhones());
      notify({ kind: "success", title: "Phone pack imported", detail: `${saved.length.toLocaleString()} records validated and saved atomically.` });
    } catch (error) {
      notify({ kind: "error", title: "Phone pack rejected", detail: (error as Error).message });
    }
  };

  const exportPhonePack = async (format: "json" | "csv") => {
    const text = format === "json" ? `${JSON.stringify(phones, null, 2)}\n` : phonePackCsv(phones);
    const result = await window.casefoundry.saveTextFile({
      title: "Export phone catalog pack",
      defaultName: `CaseFoundry-Phone-Pack.${format}`,
      text,
      filters: [{ name: format === "json" ? "JSON phone pack" : "CSV phone pack", extensions: [format] }],
    });
    if (!result.canceled) notify({ kind: "success", title: "Phone pack exported", detail: result.path });
  };

  const runRegressions = async () => {
    const targets = phones.filter((phone) => phone.tags.includes("regression"));
    setRegressionRunning(true);
    setRegressions([]);
    await ensureEngineReady();
    const results: RegressionResult[] = [];
    for (const phone of targets) {
      await waitForPaint();
      try {
        const config = tuneConfiguration(phone, { ...defaultConfiguration(phone.id), pattern: "none" });
        const built = generateCase(phone, config);
        const bytes = serializeCaseStl(built);
        const bounds = geometryBounds(built.geometry);
        const dimensions = bounds[1].map((value, index) => value - bounds[0][index]);
        const passed = built.report.printable && bytes.byteLength > 84 && dimensions.every((value) => value > 0);
        results.push({
          phoneId: phone.id,
          passed,
          polygons: built.report.metrics.polygonCount ?? 0,
          bytes: bytes.byteLength,
          detail: `${dimensions.map((value) => value.toFixed(1)).join(" × ")} mm`,
        });
      } catch (error) {
        results.push({ phoneId: phone.id, passed: false, polygons: 0, bytes: 0, detail: (error as Error).message });
      }
      setRegressions([...results]);
    }
    setRegressionRunning(false);
    notify({
      kind: results.every((result) => result.passed) ? "success" : "error",
      title: results.every((result) => result.passed) ? "Regression suite passed" : "Regression suite found failures",
      detail: `${results.filter((result) => result.passed).length}/${results.length} reference devices exported as non-empty manifold meshes.`,
    });
  };

  const content = (() => {
    if (!selectedPhone && view !== "settings") return <LoadingScreen />;
    switch (view) {
      case "dashboard":
        return (
          <DashboardView
            phones={phones}
            projects={projects}
            phone={selectedPhone!}
            generated={generated}
            stale={stale}
            configuration={configuration}
            onOpenStudio={() => setView("studio")}
            onOpenPhone={openMeasurement}
            onNavigate={setView}
          />
        );
      case "studio":
        return (
          <StudioView
            phones={phones}
            phone={selectedPhone!}
            configuration={configuration}
            validation={validation!}
            generated={generated}
            stale={stale}
            building={building}
            previewView={previewView}
            onPreviewView={setPreviewView}
            onChoosePhone={choosePhone}
            onPatch={patchConfiguration}
            onMaterial={changeMaterial}
            onTune={() => setConfiguration(tuneConfiguration(selectedPhone!, configuration))}
            onBuild={() => void buildGeometry()}
            onExport={exportPrintable}
            onExportCoupon={() => void exportFitCoupon()}
            onSaveProject={() => void saveProject()}
          />
        );
      case "phones":
        return (
          <PhoneDatabaseView
            phones={phones}
            selectedPhoneId={selectedPhone!.id}
            onSelect={(phone) => { choosePhone(phone.id); openMeasurement(phone); }}
            onCreate={() => openMeasurement(freshPhone())}
            onImport={() => void importPhonePack()}
            onExport={exportPhonePack}
          />
        );
      case "measure":
        return (
          <MeasurementView
            phones={phones}
            draft={editingPhone ?? structuredClone(selectedPhone!)}
            selectedFeatureId={selectedFeatureId}
            onSelectedFeatureId={setSelectedFeatureId}
            onChoose={(id) => { choosePhone(id); setEditingPhone(structuredClone(phones.find((phone) => phone.id === id)!)); }}
            onChange={setEditingPhone}
            onSave={() => void saveMeasurement()}
            onCreate={() => { const phone = freshPhone(); setEditingPhone(phone); setSelectedFeatureId(""); }}
          />
        );
      case "quality":
        return (
          <QualityView
            phones={phones}
            phone={selectedPhone!}
            validation={validation!}
            results={regressions}
            running={regressionRunning}
            onRun={() => void runRegressions()}
            onOpenMeasurement={() => openMeasurement(selectedPhone!)}
            onExportCoupon={() => void exportFitCoupon()}
          />
        );
      case "designs":
        return (
          <DesignLibraryView
            current={configuration.pattern}
            onUse={(pattern) => { patchConfiguration({ pattern }); setView("studio"); }}
          />
        );
      case "profiles":
        return <ProfilesView current={configuration.printerProfile} onUse={(id) => { patchConfiguration({ printerProfile: id }); setView("studio"); }} />;
      case "settings":
        return (
          <SettingsView
            info={appInfo}
            phoneCount={phones.length}
            projectCount={projects.length}
            notify={notify}
            onImportDatabase={async () => {
              const result = await window.casefoundry.importDatabase();
              if (!result.canceled && result.phones) {
                setPhones(result.phones);
                if (result.phones[0]) selectPhoneRecord(result.phones[0], false);
                notify({ kind: "success", title: "Database imported", detail: `${result.phones.length} phone records loaded.` });
              }
            }}
            onReset={async () => {
              if (!window.confirm("Reset the catalog? A recoverable backup is created first.")) return;
              const reset = await window.casefoundry.resetCatalog();
              setPhones(reset);
              if (reset[0]) selectPhoneRecord(reset[0], false);
              notify({ kind: "success", title: "Bundled catalog restored", detail: "A backup of the previous database was preserved." });
            }}
          />
        );
      default:
        return null;
    }
  })();

  return (
    <div className={`app-shell ${sidebarCompact ? "sidebar-compact" : ""}`}>
      <aside className="sidebar">
        <div className="window-drag" />
        <div className="brand-block">
          <div className="brand-mark"><Smartphone size={20} /><Sparkles size={11} /></div>
          {!sidebarCompact && <div><strong>CaseFoundry</strong><span>precision case atelier</span></div>}
        </div>
        <nav>
          <span className="nav-label">{sidebarCompact ? "" : "WORKSPACE"}</span>
          {navItems.slice(0, 6).map(({ id, label, icon: Icon }) => (
            <button key={id} className={view === id ? "active" : ""} onClick={() => setView(id)} title={label}>
              <Icon size={18} /><span>{label}</span>
            </button>
          ))}
          <span className="nav-label">{sidebarCompact ? "" : "SYSTEM"}</span>
          {navItems.slice(6).map(({ id, label, icon: Icon }) => (
            <button key={id} className={view === id ? "active" : ""} onClick={() => setView(id)} title={label}>
              <Icon size={18} /><span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          {!sidebarCompact && selectedPhone && (
            <button className="active-device" onClick={() => setView("studio")}>
              <span className="device-dot" />
              <span><small>ACTIVE DEVICE</small><strong>{selectedPhone.model}</strong></span>
              <ArrowRight size={15} />
            </button>
          )}
          <button className="collapse-button" onClick={() => setSidebarCompact((value) => !value)} title="Toggle sidebar">
            <Menu size={17} />{!sidebarCompact && <span>Collapse sidebar</span>}
          </button>
        </div>
      </aside>
      <main className="main-area">
        <div className="top-dragbar">
          <div className="crumb"><span>CaseFoundry</span><ChevronRight size={13} /><b>{navItems.find((item) => item.id === view)?.label}</b></div>
          <div className="offline-indicator"><span /> Offline engine</div>
        </div>
        <div className="page-scroll">{content}</div>
      </main>
      {toast && (
        <div className={`toast toast-${toast.kind}`}>
          {toast.kind === "success" ? <CircleCheck size={19} /> : toast.kind === "error" ? <CircleAlert size={19} /> : <Info size={19} />}
          <div><strong>{toast.title}</strong>{toast.detail && <span>{toast.detail}</span>}</div>
          <button onClick={() => setToast(null)}><X size={15} /></button>
        </div>
      )}
    </div>
  );
}

function LoadingScreen() {
  return (
    <div className="loading-screen">
      <div className="brand-mark large"><Smartphone size={28} /><Sparkles size={14} /></div>
      <LoaderCircle className="spin" size={24} />
      <strong>Opening the local foundry</strong>
      <span>Loading phone revisions and geometry services…</span>
    </div>
  );
}

function DashboardView({
  phones,
  projects,
  phone,
  generated,
  stale,
  configuration,
  onOpenStudio,
  onOpenPhone,
  onNavigate,
}: {
  phones: PhoneRecord[];
  projects: CaseProject[];
  phone: PhoneRecord;
  generated: GeneratedCase | null;
  stale: boolean;
  configuration: CaseConfiguration;
  onOpenStudio: () => void;
  onOpenPhone: (phone: PhoneRecord) => void;
  onNavigate: (view: ViewId) => void;
}) {
  const fitCount = phones.filter((entry) => entry.validation.physicalFit === "passed").length;
  const evidenceCount = phones.filter((entry) => entry.sources.some((source) => source.grade === "A" || source.grade === "B")).length;
  return (
    <div className="page dashboard-page">
      <PageHeader
        eyebrow="LOCAL PARAMETRIC WORKSHOP"
        title="Build cases that explain their certainty."
        subtitle="Phone geometry, design, material rules, and printable exports live together. Nothing is marked fit-validated until you record the physical test."
        actions={<button className="primary" onClick={onOpenStudio}><WandSparkles size={17} /> Open Case Studio</button>}
      />
      <section className="metrics-grid">
        <MetricCard label="Phone revisions" value={phones.length.toLocaleString()} detail="bulk-pack ready" icon={Database} />
        <MetricCard label="Evidence-backed" value={evidenceCount} detail="A/B source attached" icon={ShieldCheck} tone="blue" />
        <MetricCard label="Physical fits" value={fitCount} detail={fitCount ? "recorded passes" : "none claimed yet"} icon={PackageCheck} tone="amber" />
        <MetricCard label="Saved projects" value={projects.length} detail="local and private" icon={FileArchive} tone="violet" />
      </section>
      <section className="dashboard-grid">
        <article className="hero-workbench panel">
          <div className="panel-topline">
            <div><span className="eyebrow">CURRENT WORKBENCH</span><h2>{phone.brand} {phone.model}</h2></div>
            <StatusPill status={phone.status} />
          </div>
          <div className="dashboard-preview">
            <CasePreview generated={generated} material={configuration.material} view="exterior" stale={stale} />
          </div>
          <div className="workbench-footer">
            <div><span>Architecture</span><strong>{architectures[configuration.architecture].name}</strong></div>
            <div><span>Artwork</span><strong>{patterns[configuration.pattern].name}</strong></div>
            <div><span>Material</span><strong>{materials[configuration.material].name}</strong></div>
            <button className="secondary" onClick={onOpenStudio}>Continue build <ArrowRight size={15} /></button>
          </div>
        </article>
        <aside className="dashboard-side">
          <article className="panel evidence-panel">
            <div className="panel-topline"><div><span className="eyebrow">EVIDENCE STATE</span><h3>Honest readiness</h3></div><Gauge size={20} /></div>
            <div className="readiness-ring" style={{ "--score": `${phone.confidence * 3.6}deg` } as React.CSSProperties}>
              <div><strong>{phone.confidence}</strong><span>confidence</span></div>
            </div>
            <ul className="check-list">
              <li className="pass"><Check size={15} /> Body dimensions sourced</li>
              <li className={phone.validation.geometry === "passed" ? "pass" : "warn"}><Check size={15} /> Geometry regression {phone.validation.geometry}</li>
              <li className={phone.validation.physicalFit === "passed" ? "pass" : "warn"}><CircleAlert size={15} /> Physical fit {phone.validation.physicalFit}</li>
            </ul>
            <button className="text-button" onClick={() => onOpenPhone(phone)}>Review measurements <ArrowRight size={14} /></button>
          </article>
          <article className="panel quick-panel">
            <span className="eyebrow">QUICK ROUTES</span>
            <button onClick={() => onNavigate("phones")}><Database size={17} /><span><strong>Import a phone pack</strong><small>JSON or CSV, atomic validation</small></span><ArrowRight size={15} /></button>
            <button onClick={() => onNavigate("quality")}><Activity size={17} /><span><strong>Run mesh regression</strong><small>All bundled reference devices</small></span><ArrowRight size={15} /></button>
            <button onClick={() => onNavigate("designs")}><Palette size={17} /><span><strong>Explore artwork</strong><small>Three manufacturable systems</small></span><ArrowRight size={15} /></button>
          </article>
        </aside>
      </section>
      <section className="panel phone-strip">
        <div className="panel-topline"><div><span className="eyebrow">REFERENCE DEVICES</span><h3>Catalog watchlist</h3></div><button className="text-button" onClick={() => onNavigate("phones")}>View all <ArrowRight size={14} /></button></div>
        <div className="phone-strip-grid">
          {phones.slice(0, 4).map((entry) => (
            <button key={entry.id} onClick={() => onOpenPhone(entry)}>
              <div className="mini-phone"><span /></div>
              <div><strong>{entry.model}</strong><span>{entry.variant}</span><Confidence value={entry.confidence} /></div>
              <StatusPill status={entry.status} />
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

function StudioView({
  phones,
  phone,
  configuration,
  validation,
  generated,
  stale,
  building,
  previewView,
  onPreviewView,
  onChoosePhone,
  onPatch,
  onMaterial,
  onTune,
  onBuild,
  onExport,
  onExportCoupon,
  onSaveProject,
}: {
  phones: PhoneRecord[];
  phone: PhoneRecord;
  configuration: CaseConfiguration;
  validation: ReturnType<typeof validateCase>;
  generated: GeneratedCase | null;
  stale: boolean;
  building: boolean;
  previewView: "exterior" | "phone";
  onPreviewView: (view: "exterior" | "phone") => void;
  onChoosePhone: (id: string) => void;
  onPatch: (patch: Partial<CaseConfiguration>) => void;
  onMaterial: (id: MaterialId) => void;
  onTune: () => void;
  onBuild: () => void;
  onExport: (format: "stl" | "3mf") => void;
  onExportCoupon: () => void;
  onSaveProject: () => void;
}) {
  const [controlTab, setControlTab] = useState<"structure" | "art" | "print">("structure");
  const metricReport = !stale && generated ? generated.report : validation;
  return (
    <div className="studio-page">
      <div className="studio-toolbar">
        <div>
          <span className="eyebrow">PARAMETRIC CASE STUDIO</span>
          <h1>{phone.model} <span>/ {patterns[configuration.pattern].name}</span></h1>
        </div>
        <div className="toolbar-actions">
          <button className="secondary" onClick={onExportCoupon} disabled={building}><Ruler size={16} /> Fit coupons</button>
          <button className="secondary" onClick={onSaveProject}><Save size={16} /> Save project</button>
          <div className="export-split">
            <button disabled={!validation.printable || building} onClick={() => onExport("3mf")}><Download size={16} /> Export 3MF</button>
            <button disabled={!validation.printable || building} onClick={() => onExport("stl")}>STL</button>
          </div>
        </div>
      </div>
      <div className="studio-layout">
        <aside className="studio-controls panel">
          <label className="field-label">PHONE REVISION</label>
          <select value={phone.id} onChange={(event) => onChoosePhone(event.target.value)}>
            {phones.map((entry) => <option key={entry.id} value={entry.id}>{entry.brand} {entry.model} · {entry.variant}</option>)}
          </select>
          <div className="record-mini-state"><StatusPill status={phone.status} /><Confidence value={phone.confidence} /></div>
          <div className="segmented three">
            <button className={controlTab === "structure" ? "active" : ""} onClick={() => setControlTab("structure")}>Structure</button>
            <button className={controlTab === "art" ? "active" : ""} onClick={() => setControlTab("art")}>Artwork</button>
            <button className={controlTab === "print" ? "active" : ""} onClick={() => setControlTab("print")}>Print</button>
          </div>
          {controlTab === "structure" && (
            <div className="control-stack">
              <FieldSelect label="Architecture" value={configuration.architecture} onChange={(value) => onPatch({ architecture: value as CaseConfiguration["architecture"] })}>
                {Object.entries(architectures).map(([id, item]) => <option key={id} value={id}>{item.name}</option>)}
              </FieldSelect>
              <FieldSelect label="Printer" value={configuration.printerId} onChange={(value) => onPatch({ printerId: value })}>
                {Object.values(PRINTERS).map((printer) => (
                  <option key={printer.id} value={printer.id}>{printer.name} · {printer.nozzle} mm</option>
                ))}
              </FieldSelect>
              <FieldSelect label="Material system" value={configuration.material} onChange={(value) => onMaterial(value as MaterialId)}>
                {Object.entries(materials).map(([id, item]) => <option key={id} value={id}>{item.name}</option>)}
              </FieldSelect>
              <RangeField label="Per-side clearance" value={configuration.tolerance} min={0.2} max={0.8} step={0.02} unit="mm" onChange={(value) => onPatch({ tolerance: value })} />
              <RangeField label="Wall" value={configuration.wall} min={1.2} max={3} step={0.05} unit="mm" onChange={(value) => onPatch({ wall: value })} />
              <RangeField label="Backplate" value={configuration.backThickness} min={0.8} max={3.2} step={0.05} unit="mm" onChange={(value) => onPatch({ backThickness: value })} />
              <RangeField label="Screen lip" value={configuration.lipHeight} min={0.5} max={2} step={0.05} unit="mm" onChange={(value) => onPatch({ lipHeight: value })} />
              <RangeField label="Camera margin" value={configuration.cameraMargin} min={0.8} max={3.5} step={0.1} unit="mm" onChange={(value) => onPatch({ cameraMargin: value })} />
              <FieldSelect label="Button treatment" value={configuration.buttonStyle} onChange={(value) => onPatch({ buttonStyle: value as "open" | "covered" })}>
                <option value="open">Open side notch · no bridge</option>
                <option value="covered" disabled={!materials[configuration.material].flexible}>Covered flex buttons · TPU only</option>
              </FieldSelect>
              <div className="toggle-row"><Toggle checked={configuration.topOpening} onChange={(value) => onPatch({ topOpening: value })} /><span><strong>Open top edge</strong><small>Leaves protected corners</small></span></div>
              <div className="toggle-row"><Toggle checked={configuration.bottomOpening} onChange={(value) => onPatch({ bottomOpening: value })} /><span><strong>Open bottom edge</strong><small>Ports remain unobstructed</small></span></div>
            </div>
          )}
          {controlTab === "art" && (
            <div className="control-stack">
              <div className="pattern-picker">
                {(Object.keys(patterns) as PatternId[]).map((id) => (
                  <button key={id} className={configuration.pattern === id ? "active" : ""} onClick={() => onPatch({ pattern: id })}>
                    <PatternSwatch pattern={id} /><span>{patterns[id].name}</span>
                  </button>
                ))}
              </div>
              <FieldSelect label="Artwork construction" value={configuration.patternMode} onChange={(value) => onPatch({ patternMode: value as CaseConfiguration["patternMode"] })}>
                <option value="sealed">Buried optical channel · one filament</option>
                <option value="inlay" disabled={configuration.material !== "petg-translucent"}>Opaque inlay · translucent + opaque PETG</option>
                <option value="engraved">Exterior engraving</option>
                <option value="vented">Through-vented</option>
              </FieldSelect>
              <RangeField label="Artwork depth" value={configuration.patternDepth} min={0.2} max={1.4} step={0.05} unit="mm" onChange={(value) => onPatch({ patternDepth: value })} />
              <RangeField label="Pattern scale" value={configuration.patternScale} min={0.75} max={1.5} step={0.05} unit="×" onChange={(value) => onPatch({ patternScale: value })} />
              <label className="color-field"><span>Shell preview color</span><input type="color" value={configuration.color} onChange={(event) => onPatch({ color: event.target.value })} /><code>{configuration.color}</code></label>
              {configuration.patternMode === "sealed" && configuration.pattern !== "none" && (
                <div className="callout magic"><Sparkles size={18} /><div><strong>Buried optical pattern</strong><span>The Kumiko channel stays enclosed between two continuous skins and reads through translucent PETG. This export uses one translucent filament.</span></div></div>
              )}
              {configuration.patternMode === "inlay" && configuration.pattern !== "none" && (
                <div className="callout magic"><Sparkles size={18} /><div><strong>Two-material 3MF</strong><span>The translucent shell and opaque Kumiko inlay export as separate aligned parts. Slot 1 is translucent PETG; slot 2 is opaque PETG.</span></div></div>
              )}
            </div>
          )}
          {controlTab === "print" && (
            <div className="control-stack">
              <FieldSelect label="Printer profile" value={configuration.printerProfile} onChange={(value) => onPatch({ printerProfile: value })}>
                {printProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
              </FieldSelect>
              <FieldSelect label="Nozzle" value={String(configuration.nozzle)} onChange={(value) => onPatch({ nozzle: Number(value) })}>
                <option value="0.4">0.4 mm</option><option value="0.6">0.6 mm</option>
              </FieldSelect>
              {(() => {
                const profile = printProfiles.find((entry) => entry.id === configuration.printerProfile) ?? printProfiles[0];
                return (
                  <div className="profile-summary">
                    <div><span>Layer</span><strong>{profile.layerHeight} mm</strong></div>
                    <div><span>Nozzle</span><strong>{profile.nozzleTemperature} °C</strong></div>
                    <div><span>Bed</span><strong>{profile.bedTemperature} °C</strong></div>
                    <div><span>Walls</span><strong>{profile.walls}</strong></div>
                    <p>{profile.notes}</p>
                  </div>
                );
              })()}
              <div className="callout"><Info size={17} /><div><strong>Print orientation</strong><span>Back-flat, exterior face on the build plate. The phone-facing surface is generated clean and continuous.</span></div></div>
            </div>
          )}
          <div className="control-footer">
            <button className="secondary" onClick={onTune}><SlidersHorizontal size={16} /> Auto-tune material</button>
            <button className="primary wide" onClick={onBuild} disabled={building}>
              {building ? <LoaderCircle className="spin" size={17} /> : <WandSparkles size={17} />}
              {building ? "Building geometry…" : stale ? "Build updated geometry" : "Rebuild geometry"}
            </button>
          </div>
        </aside>
        <section className="studio-canvas panel">
          <div className="canvas-toolbar">
            <div className="segmented"><button className={previewView === "exterior" ? "active" : ""} onClick={() => onPreviewView("exterior")}>Exterior</button><button className={previewView === "phone" ? "active" : ""} onClick={() => onPreviewView("phone")}>Phone side</button></div>
            <span className="orientation-note">{previewView === "exterior" ? "Rear view mirrors X visually" : "Canonical screen orientation"}</span>
          </div>
          <CasePreview generated={generated} material={configuration.material} view={previewView} stale={stale} />
          <div className="canvas-metrics">
            <div><span>Outer size</span><strong>{metricReport.metrics.outerWidth} × {metricReport.metrics.outerLength} × {metricReport.metrics.outerHeight} mm</strong></div>
            <div><span>Estimate</span><strong>{metricReport.metrics.estimatedWeightG} g · {metricReport.metrics.estimatedMinutes} min</strong></div>
            <div><span>Cutouts</span><strong>{metricReport.metrics.featureCutouts || phone.features.length} protected features</strong></div>
          </div>
        </section>
        <aside className="studio-qa panel">
          <div className="score-header">
            <div className={`score-badge ${validation.printable ? "good" : "bad"}`}><strong>{validation.score}</strong><span>/100</span></div>
            <div><span className="eyebrow">LIVE PREFLIGHT</span><h3>{validation.printable ? "Printable configuration" : "Export blocked"}</h3></div>
          </div>
          <div className="qa-summary">
            <div><span>Minimum skin</span><strong>{validation.metrics.minimumSkin} mm</strong></div>
            <div><span>Record confidence</span><strong>{phone.confidence}%</strong></div>
            <div><span>Fit status</span><strong>{phone.validation.physicalFit}</strong></div>
          </div>
          <div className="issue-list">{validation.issues.map((issue) => <IssueRow key={issue.id} issue={issue} />)}</div>
          <div className="qa-bottom"><ShieldCheck size={16} /><span>Preflight catches geometry and material risks. It cannot replace a physical fit coupon.</span></div>
        </aside>
      </div>
    </div>
  );
}

function FieldSelect({ label, value, onChange, children }: { label: string; value: string; onChange: (value: string) => void; children: React.ReactNode }) {
  return <label className="field"><span>{label}</span><select value={value} onChange={(event) => onChange(event.target.value)}>{children}</select></label>;
}

function RangeField({ label, value, min, max, step, unit, onChange }: { label: string; value: number; min: number; max: number; step: number; unit: string; onChange: (value: number) => void }) {
  return (
    <label className="range-field">
      <span><b>{label}</b><code>{value.toFixed(step < 0.1 ? 2 : 1)} {unit}</code></span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} />
    </label>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (value: boolean) => void }) {
  return <button type="button" className={`toggle ${checked ? "on" : ""}`} onClick={() => onChange(!checked)}><span /></button>;
}

function PhoneDatabaseView({
  phones,
  selectedPhoneId,
  onSelect,
  onCreate,
  onImport,
  onExport,
}: {
  phones: PhoneRecord[];
  selectedPhoneId: string;
  onSelect: (phone: PhoneRecord) => void;
  onCreate: () => void;
  onImport: () => void;
  onExport: (format: "json" | "csv") => void;
}) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<VerificationStatus | "all">("all");
  const [page, setPage] = useState(0);
  const pageSize = 50;
  const filtered = useMemo(() => phones.filter((phone) => {
    const text = `${phone.brand} ${phone.model} ${phone.variant} ${phone.modelNumbers.join(" ")} ${phone.tags.join(" ")}`.toLowerCase();
    return text.includes(search.toLowerCase()) && (filter === "all" || phone.status === filter);
  }), [phones, search, filter]);
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const visible = filtered.slice(page * pageSize, page * pageSize + pageSize);
  useEffect(() => setPage(0), [search, filter]);
  return (
    <div className="page">
      <PageHeader
        eyebrow="SCALABLE LOCAL CATALOG"
        title="Phone Database"
        subtitle="Store thousands of chassis revisions without pretending a sourced body dimension proves button or camera placement."
        actions={<><button className="secondary" onClick={onImport}><Import size={16} /> Import pack</button><button className="primary" onClick={onCreate}><Plus size={16} /> New phone</button></>}
      />
      <section className="catalog-toolbar panel">
        <label className="search-box"><Search size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search model, number, family, or tag…" /></label>
        <select value={filter} onChange={(event) => setFilter(event.target.value as VerificationStatus | "all")}><option value="all">All evidence states</option>{statusOptions.map((status) => <option key={status} value={status}>{statusLabel(status)}</option>)}</select>
        <div className="catalog-count"><strong>{filtered.length.toLocaleString()}</strong><span>matching revisions</span></div>
        <div className="export-menu"><button onClick={() => onExport("json")}><Download size={15} /> JSON</button><button onClick={() => onExport("csv")}>CSV</button></div>
      </section>
      <section className="catalog-table panel">
        <div className="catalog-row catalog-head"><span>Phone revision</span><span>Evidence</span><span>Body W × L × D</span><span>Features</span><span>Validation</span><span /></div>
        {visible.map((phone) => (
          <button key={phone.id} className={`catalog-row ${phone.id === selectedPhoneId ? "selected" : ""}`} onClick={() => onSelect(phone)}>
            <span className="phone-identity"><span className="tiny-phone" /><span><strong>{phone.brand} {phone.model}</strong><small>{phone.variant} · {phone.modelNumbers.slice(0, 2).join(" / ")}</small></span></span>
            <span><StatusPill status={phone.status} /><Confidence value={phone.confidence} /></span>
            <span className="dimensions"><strong>{phone.dimensions.width} × {phone.dimensions.length} × {phone.dimensions.depth}</strong><small>R {phone.dimensions.cornerRadius} mm</small></span>
            <span className="feature-count"><strong>{phone.features.length}</strong><small>{phone.sources.length} sources</small></span>
            <span className="validation-dots"><i className={phone.validation.geometry === "passed" ? "pass" : ""}>G</i><i className={phone.validation.slice === "passed" ? "pass" : ""}>S</i><i className={phone.validation.physicalFit === "passed" ? "pass" : ""}>F</i></span>
            <span><ChevronRight size={16} /></span>
          </button>
        ))}
        {!visible.length && <div className="empty-state"><Search size={24} /><strong>No phone revisions match</strong><span>Clear the query or import another evidence pack.</span></div>}
        <div className="pagination"><span>Showing {filtered.length ? page * pageSize + 1 : 0}–{Math.min((page + 1) * pageSize, filtered.length)} of {filtered.length.toLocaleString()}</span><div><button disabled={page === 0} onClick={() => setPage((value) => value - 1)}><ChevronLeft size={16} /></button><span>{page + 1} / {pages}</span><button disabled={page + 1 >= pages} onClick={() => setPage((value) => value + 1)}><ChevronRight size={16} /></button></div></div>
      </section>
      <div className="catalog-footnote"><ShieldCheck size={17} /><span>Bulk import validates required body fields, preserves feature-level confidence, and writes the pack in one atomic database transaction.</span></div>
    </div>
  );
}

function MeasurementView({
  phones,
  draft,
  selectedFeatureId,
  onSelectedFeatureId,
  onChoose,
  onChange,
  onSave,
  onCreate,
}: {
  phones: PhoneRecord[];
  draft: PhoneRecord;
  selectedFeatureId: string;
  onSelectedFeatureId: (id: string) => void;
  onChoose: (id: string) => void;
  onChange: (phone: PhoneRecord) => void;
  onSave: () => void;
  onCreate: () => void;
}) {
  const [diagramView, setDiagramView] = useState<"screen" | "rear">("screen");
  const selectedFeature = draft.features.find((feature) => feature.id === selectedFeatureId) ?? null;
  const update = (patch: Partial<PhoneRecord>) => onChange({ ...draft, ...patch });
  const updateDimensions = (key: keyof PhoneRecord["dimensions"], value: number) => update({ dimensions: { ...draft.dimensions, [key]: value } });
  const updateFeature = (patch: Partial<PhoneFeature>) => {
    if (!selectedFeature) return;
    update({ features: draft.features.map((feature) => feature.id === selectedFeature.id ? { ...feature, ...patch } : feature) });
  };
  const updateVector = (vector: "center" | "size", key: "x" | "y" | "z", value: number) => {
    if (!selectedFeature) return;
    updateFeature({ [vector]: { ...selectedFeature[vector], [key]: value } });
  };
  return (
    <div className="page measurement-page">
      <PageHeader
        eyebrow="CANONICAL COORDINATE EDITOR"
        title="Measurement Lab"
        subtitle="+X is always screen-right, +Y is the top, and +Z points toward the screen. Rear diagrams mirror X visually without changing stored coordinates."
        actions={<><button className="secondary" onClick={onCreate}><Plus size={16} /> Blank record</button><button className="primary" onClick={onSave}><Save size={16} /> Save revision</button></>}
      />
      <section className="measurement-selector panel">
        <label><span>EDITING RECORD</span><select value={phones.some((phone) => phone.id === draft.id) ? draft.id : ""} onChange={(event) => onChoose(event.target.value)}><option value="" disabled>Unsaved new phone</option>{phones.map((phone) => <option key={phone.id} value={phone.id}>{phone.brand} {phone.model} · {phone.variant}</option>)}</select></label>
        <div><StatusPill status={draft.status} /><span>Revision {draft.revision}</span><span>Updated {humanDate(draft.updatedAt)}</span></div>
      </section>
      <div className="measurement-grid">
        <section className="panel identity-editor">
          <div className="section-title"><div><span className="eyebrow">01 · IDENTITY</span><h3>Chassis record</h3></div><Smartphone size={20} /></div>
          <div className="form-grid two">
            <TextInput label="Brand" value={draft.brand} onChange={(value) => update({ brand: value })} />
            <TextInput label="Model" value={draft.model} onChange={(value) => update({ model: value })} />
            <TextInput label="Variant" value={draft.variant} onChange={(value) => update({ variant: value })} />
            <TextInput label="Chassis family" value={draft.chassisFamily} onChange={(value) => update({ chassisFamily: value })} />
            <TextInput label="Model numbers" value={draft.modelNumbers.join(", ")} onChange={(value) => update({ modelNumbers: value.split(",").map((item) => item.trim()).filter(Boolean) })} />
            <NumberInput label="Release year" value={draft.releaseYear} onChange={(value) => update({ releaseYear: value })} />
            <label className="field"><span>Evidence status</span><select value={draft.status} onChange={(event) => update({ status: event.target.value as VerificationStatus })}>{statusOptions.map((status) => <option key={status} value={status}>{statusLabel(status)}</option>)}</select></label>
            <NumberInput label="Catalog confidence %" value={draft.confidence} min={0} max={100} onChange={(value) => update({ confidence: value })} />
          </div>
          <label className="field"><span>Notes and fit caveats</span><textarea rows={4} value={draft.notes} onChange={(event) => update({ notes: event.target.value })} /></label>
        </section>
        <section className="panel body-editor">
          <div className="section-title"><div><span className="eyebrow">02 · BODY</span><h3>Nominal envelope</h3></div><Ruler size={20} /></div>
          <div className="dimension-cards">
            <NumberInput label="Width · X" value={draft.dimensions.width} step={0.05} suffix="mm" onChange={(value) => updateDimensions("width", value)} />
            <NumberInput label="Length · Y" value={draft.dimensions.length} step={0.05} suffix="mm" onChange={(value) => updateDimensions("length", value)} />
            <NumberInput label="Depth · Z" value={draft.dimensions.depth} step={0.05} suffix="mm" onChange={(value) => updateDimensions("depth", value)} />
            <NumberInput label="Corner radius" value={draft.dimensions.cornerRadius} step={0.1} suffix="mm" onChange={(value) => updateDimensions("cornerRadius", value)} />
          </div>
          <div className="validation-editor">
            <label><span>Geometry</span><select value={draft.validation.geometry} onChange={(event) => update({ validation: { ...draft.validation, geometry: event.target.value as PhoneRecord["validation"]["geometry"] } })}><option value="not-run">Not run</option><option value="passed">Passed</option><option value="failed">Failed</option></select></label>
            <label><span>Slice</span><select value={draft.validation.slice} onChange={(event) => update({ validation: { ...draft.validation, slice: event.target.value as PhoneRecord["validation"]["slice"] } })}><option value="not-run">Not run</option><option value="passed">Passed</option><option value="failed">Failed</option></select></label>
            <label><span>Physical fit</span><select value={draft.validation.physicalFit} onChange={(event) => update({ validation: { ...draft.validation, physicalFit: event.target.value as PhoneRecord["validation"]["physicalFit"] } })}><option value="not-tested">Not tested</option><option value="passed">Passed</option><option value="failed">Failed</option></select></label>
          </div>
          <div className="callout warning"><CircleAlert size={17} /><div><strong>Status is an assertion</strong><span>Only set Physical fit to Passed after testing this exact chassis revision, button side, camera clearance, and ports.</span></div></div>
        </section>
        <section className="panel diagram-editor">
          <div className="section-title"><div><span className="eyebrow">03 · ORIENTATION</span><h3>Placement map</h3></div><div className="segmented"><button className={diagramView === "screen" ? "active" : ""} onClick={() => setDiagramView("screen")}>Screen</button><button className={diagramView === "rear" ? "active" : ""} onClick={() => setDiagramView("rear")}>Rear</button></div></div>
          <PhoneDiagram phone={draft} view={diagramView} selectedFeatureId={selectedFeatureId} onSelectFeature={(feature) => onSelectedFeatureId(feature.id)} />
        </section>
        <section className="panel features-editor">
          <div className="section-title"><div><span className="eyebrow">04 · HARDWARE</span><h3>{draft.features.length} measured features</h3></div><button className="icon-text" onClick={() => { const feature = freshFeature(); update({ features: [...draft.features, feature] }); onSelectedFeatureId(feature.id); }}><Plus size={15} /> Add</button></div>
          <div className="feature-workspace">
            <div className="feature-list">
              {draft.features.map((feature) => (
                <button key={feature.id} className={feature.id === selectedFeatureId ? "active" : ""} onClick={() => onSelectedFeatureId(feature.id)}>
                  <span className={`feature-kind kind-${feature.kind}`} /><span><strong>{feature.name}</strong><small>{feature.side} · {feature.kind}</small></span><b>{feature.confidence}%</b>
                </button>
              ))}
              {!draft.features.length && <div className="empty-small">No hardware features yet.</div>}
            </div>
            {selectedFeature ? (
              <div className="feature-detail">
                <div className="form-grid two compact">
                  <TextInput label="Name" value={selectedFeature.name} onChange={(value) => updateFeature({ name: value })} />
                  <label className="field"><span>Kind</span><select value={selectedFeature.kind} onChange={(event) => updateFeature({ kind: event.target.value as FeatureKind })}>{featureKinds.map((kind) => <option key={kind} value={kind}>{statusLabel(kind)}</option>)}</select></label>
                  <label className="field"><span>Physical side</span><select value={selectedFeature.side} onChange={(event) => updateFeature({ side: event.target.value as FeatureSide })}>{featureSides.map((side) => <option key={side} value={side}>{side}</option>)}</select></label>
                  <label className="field"><span>Shape</span><select value={selectedFeature.shape} onChange={(event) => updateFeature({ shape: event.target.value as FeatureShape })}>{featureShapes.map((shape) => <option key={shape} value={shape}>{shape}</option>)}</select></label>
                </div>
                <div className="vector-editor"><span>Center · mm</span>{(["x", "y", "z"] as const).map((axis) => <NumberInput key={axis} label={axis.toUpperCase()} value={selectedFeature.center[axis]} step={0.1} onChange={(value) => updateVector("center", axis, value)} />)}</div>
                <div className="vector-editor"><span>Size · mm</span>{(["x", "y", "z"] as const).map((axis) => <NumberInput key={axis} label={axis.toUpperCase()} value={selectedFeature.size[axis]} step={0.1} min={0.1} onChange={(value) => updateVector("size", axis, value)} />)}</div>
                <RangeField label="Feature confidence" value={selectedFeature.confidence} min={0} max={100} step={1} unit="%" onChange={(value) => updateFeature({ confidence: value })} />
                <button className="danger-text" onClick={() => { update({ features: draft.features.filter((feature) => feature.id !== selectedFeature.id) }); onSelectedFeatureId(""); }}><Trash2 size={15} /> Remove feature</button>
              </div>
            ) : <div className="feature-placeholder"><CircleDotIcon /><strong>Select a feature</strong><span>Edit its canonical center, envelope, side, and confidence.</span></div>}
          </div>
        </section>
        <section className="panel sources-editor">
          <div className="section-title"><div><span className="eyebrow">05 · PROVENANCE</span><h3>Evidence sources</h3></div><button className="icon-text" onClick={() => update({ sources: [...draft.sources, { id: `source-${Date.now()}`, title: "New source", kind: "physical-measurement", grade: "B" }] })}><Plus size={15} /> Add source</button></div>
          <div className="source-list">
            {draft.sources.map((source, index) => (
              <div key={source.id} className="source-row">
                <span className={`source-grade grade-${source.grade}`}>{source.grade}</span>
                <input value={source.title} onChange={(event) => update({ sources: draft.sources.map((entry, sourceIndex) => sourceIndex === index ? { ...entry, title: event.target.value } : entry) })} />
                <select value={source.kind} onChange={(event) => update({ sources: draft.sources.map((entry, sourceIndex) => sourceIndex === index ? { ...entry, kind: event.target.value as typeof entry.kind } : entry) })}><option value="manufacturer">Manufacturer</option><option value="licensed-cad">Licensed CAD</option><option value="physical-measurement">Physical measurement</option><option value="calibrated-scan">Calibrated scan</option><option value="reference-mesh">Reference mesh</option><option value="community">Community</option><option value="inference">Inference</option></select>
                <input placeholder="URL or reference ID" value={source.url || ""} onChange={(event) => update({ sources: draft.sources.map((entry, sourceIndex) => sourceIndex === index ? { ...entry, url: event.target.value } : entry) })} />
                <select value={source.grade} onChange={(event) => update({ sources: draft.sources.map((entry, sourceIndex) => sourceIndex === index ? { ...entry, grade: event.target.value as typeof entry.grade } : entry) })}><option value="A">A</option><option value="B">B</option><option value="C">C</option><option value="D">D</option></select>
                <button onClick={() => update({ sources: draft.sources.filter((_, sourceIndex) => sourceIndex !== index) })}><Trash2 size={14} /></button>
              </div>
            ))}
            {!draft.sources.length && <div className="empty-state compact"><FileArchive size={20} /><strong>No evidence attached</strong><span>This record stays provisional until a source is added.</span></div>}
          </div>
        </section>
      </div>
    </div>
  );
}

function CircleDotIcon() { return <div className="placeholder-target"><span /></div>; }

function TextInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="field"><span>{label}</span><input value={value} onChange={(event) => onChange(event.target.value)} /></label>;
}

function NumberInput({ label, value, onChange, step = 1, min, max, suffix }: { label: string; value: number; onChange: (value: number) => void; step?: number; min?: number; max?: number; suffix?: string }) {
  return <label className="field number-field"><span>{label}</span><span className="number-wrap"><input type="number" value={value} step={step} min={min} max={max} onChange={(event) => onChange(Number(event.target.value))} />{suffix && <i>{suffix}</i>}</span></label>;
}

function QualityView({ phones, phone, validation, results, running, onRun, onOpenMeasurement, onExportCoupon }: { phones: PhoneRecord[]; phone: PhoneRecord; validation: ReturnType<typeof validateCase>; results: RegressionResult[]; running: boolean; onRun: () => void; onOpenMeasurement: () => void; onExportCoupon: () => void }) {
  const regressions = phones.filter((entry) => entry.tags.includes("regression"));
  const passed = results.filter((result) => result.passed).length;
  return (
    <div className="page">
      <PageHeader eyebrow="GEOMETRY AND EVIDENCE GATES" title="Quality Center" subtitle="Run real mesh/export checks, inspect DFM rules, and keep physical-fit claims separate from computational passes." actions={<button className="primary" onClick={onRun} disabled={running}>{running ? <LoaderCircle className="spin" size={16} /> : <Activity size={16} />} {running ? "Running suite…" : "Run mesh regression"}</button>} />
      <section className="metrics-grid quality-metrics">
        <MetricCard label="Current DFM score" value={validation.score} detail={validation.printable ? "export gate open" : "blocking errors"} icon={Gauge} />
        <MetricCard label="Regression devices" value={regressions.length} detail="bundled test fixtures" icon={Smartphone} tone="blue" />
        <MetricCard label="Last run passed" value={results.length ? `${passed}/${results.length}` : "Not run"} detail="non-empty STL meshes" icon={PackageCheck} tone="amber" />
        <MetricCard label="Physical fit" value={phones.filter((entry) => entry.validation.physicalFit === "passed").length} detail="explicitly recorded" icon={ShieldCheck} tone="violet" />
      </section>
      <div className="quality-grid">
        <section className="panel current-preflight">
          <div className="panel-topline"><div><span className="eyebrow">CURRENT CONFIGURATION</span><h3>{phone.brand} {phone.model}</h3></div><div className={`score-badge ${validation.printable ? "good" : "bad"}`}><strong>{validation.score}</strong><span>/100</span></div></div>
          <div className="issue-list expanded">{validation.issues.map((issue) => <IssueRow key={issue.id} issue={issue} />)}</div>
        </section>
        <section className="panel regression-panel">
          <div className="panel-topline"><div><span className="eyebrow">AUTOMATED REGRESSION</span><h3>Reference mesh health</h3></div><Activity size={20} /></div>
          <p>Each run constructs a plain tuned shell, performs booleans, checks positive bounds, triangulates it, and serializes a binary STL.</p>
          <div className="regression-list">
            {regressions.map((entry) => {
              const result = results.find((item) => item.phoneId === entry.id);
              return (
                <div key={entry.id}>
                  <span className={`run-state ${result ? result.passed ? "pass" : "fail" : "idle"}`}>{result ? result.passed ? <Check size={14} /> : <X size={14} /> : running ? <LoaderCircle className="spin" size={14} /> : "·"}</span>
                  <span><strong>{entry.model}</strong><small>{result ? `${result.detail} · ${result.polygons.toLocaleString()} polygons · ${result.bytes.toLocaleString()} bytes` : "Awaiting run"}</small></span>
                </div>
              );
            })}
          </div>
        </section>
        <section className="panel fit-gate">
          <div><span className="eyebrow">PHYSICAL GATE</span><h3>A computer cannot press the buttons.</h3><p>Before selling or committing to a long decorative print, make a short coupon covering the button zone, one camera corner, and the bottom ports.</p></div>
          <div className="fit-steps"><span><b>01</b> Print coupon</span><span><b>02</b> Check click + clearance</span><span><b>03</b> Record exact handset variant</span><span><b>04</b> Promote revision</span></div>
          <div className="fit-actions"><button className="primary" onClick={onExportCoupon}><Download size={15} /> Export fit coupons</button><button className="secondary" onClick={onOpenMeasurement}>Validation record <ArrowRight size={15} /></button></div>
        </section>
      </div>
    </div>
  );
}

function DesignLibraryView({ current, onUse }: { current: PatternId; onUse: (pattern: PatternId) => void }) {
  return (
    <div className="page">
      <PageHeader eyebrow="MANUFACTURABLE ART SYSTEMS" title="Design Library" subtitle="Every built-in pattern has a minimum printable stroke, camera keepout, edge margin, and a sealed construction option." />
      <section className="design-grid">
        {(Object.keys(patterns) as PatternId[]).map((id, index) => (
          <article key={id} className={`design-card panel ${id === current ? "selected" : ""}`}>
            <PatternSwatch pattern={id} />
            <div className="design-index">0{index + 1}</div>
            <span className="eyebrow">{patterns[id].family}</span>
            <h3>{patterns[id].name}</h3>
            <p>{patterns[id].description}</p>
            <div className="design-meta"><span>First-layer risk <b>{patterns[id].risk}</b></span><span>Camera keepout <b>Automatic</b></span></div>
            <button className={id === current ? "secondary" : "primary"} onClick={() => onUse(id)}>{id === current ? <Check size={15} /> : <Sparkles size={15} />}{id === current ? "In current project" : "Use this system"}</button>
          </article>
        ))}
      </section>
      <section className="panel design-rulebook"><div><Sparkles size={23} /><span><strong>The magical transparent construction</strong><small>Buried artwork becomes a separate 3MF object between a continuous outer skin and a clean phone-facing skin.</small></span></div><div><span>Recommended shell</span><strong>Translucent PETG</strong></div><div><span>Recommended inlay</span><strong>Opaque PETG</strong></div><div><span>Avoid</span><strong>PLA/PETG mixed bond</strong></div></section>
    </div>
  );
}

function ProfilesView({ current, onUse }: { current: string; onUse: (id: string) => void }) {
  return (
    <div className="page">
      <PageHeader eyebrow="BAMBU LAB P2S STARTING POINTS" title="Print Profiles" subtitle="Material-aware starting profiles for a 0.4 mm nozzle. Dry filament and run printer calibration before a production case." />
      <section className="profiles-grid">
        {printProfiles.map((profile) => (
          <article key={profile.id} className={`profile-card panel ${profile.id === current ? "selected" : ""}`}>
            <div className="profile-top"><span className="material-chip" style={{ background: materials[profile.material].color }} /><div><span className="eyebrow">{materials[profile.material].name}</span><h3>{profile.name}</h3></div>{profile.id === current && <span className="current-badge"><Check size={13} /> Active</span>}</div>
            <div className="profile-values"><div><span>Layer</span><strong>{profile.layerHeight} mm</strong></div><div><span>Nozzle</span><strong>{profile.nozzleTemperature} °C</strong></div><div><span>Bed</span><strong>{profile.bedTemperature} °C</strong></div><div><span>Walls</span><strong>{profile.walls}</strong></div><div><span>Outer wall</span><strong>{profile.outerWallSpeed} mm/s</strong></div><div><span>First layer</span><strong>{profile.firstLayerSpeed} mm/s</strong></div></div>
            <p>{profile.notes}</p><div className="fan-row"><span>Cooling</span><strong>{profile.fan}</strong></div><button className={profile.id === current ? "secondary" : "primary"} onClick={() => onUse(profile.id)}>{profile.id === current ? "Current studio profile" : "Use in Case Studio"}</button>
          </article>
        ))}
      </section>
      <div className="profile-disclaimer"><CircleAlert size={17} /><span>These are engineering starting points, not guaranteed machine presets. Flow ratio, pressure advance, filament moisture, plate condition, and the exact P2S firmware/profile still affect the result.</span></div>
    </div>
  );
}

function SettingsView({ info, phoneCount, projectCount, notify, onImportDatabase, onReset }: { info: AppInfo | null; phoneCount: number; projectCount: number; notify: (toast: ToastState) => void; onImportDatabase: () => Promise<void>; onReset: () => Promise<void> }) {
  return (
    <div className="page settings-page">
      <PageHeader eyebrow="LOCAL-FIRST CONTROL" title="Settings" subtitle="CaseFoundry stores its catalog and projects on this Mac. There is no account, cloud dependency, or telemetry." />
      <section className="settings-grid">
        <article className="panel settings-card">
          <div className="section-title"><div><span className="eyebrow">DATA</span><h3>Local database</h3></div><HardDrive size={20} /></div>
          <div className="storage-stats"><div><strong>{phoneCount}</strong><span>phone revisions</span></div><div><strong>{projectCount}</strong><span>saved projects</span></div></div>
          <label className="path-field"><span>Database file</span><code>{info?.databaseFile ?? "Loading…"}</code></label>
          <div className="settings-actions"><button className="secondary" onClick={() => window.casefoundry.revealDataFolder()}><FolderOpen size={16} /> Reveal</button><button className="secondary" onClick={async () => { const result = await window.casefoundry.createBackup(); notify({ kind: "success", title: "Backup created", detail: result.path }); }}><Copy size={16} /> Backup</button></div>
        </article>
        <article className="panel settings-card">
          <div className="section-title"><div><span className="eyebrow">PORTABILITY</span><h3>Move the whole workshop</h3></div><FileArchive size={20} /></div>
          <p>Full database export includes phones, feature evidence, validation state, saved projects, and the audit trail.</p>
          <div className="settings-actions vertical"><button className="primary" onClick={async () => { const result = await window.casefoundry.exportDatabase(); if (!result.canceled) notify({ kind: "success", title: "Database exported", detail: result.path }); }}><Upload size={16} /> Export database</button><button className="secondary" onClick={() => void onImportDatabase()}><Download size={16} /> Import database</button></div>
        </article>
        <article className="panel settings-card">
          <div className="section-title"><div><span className="eyebrow">APPLICATION</span><h3>Runtime information</h3></div><Info size={20} /></div>
          <dl className="about-list"><div><dt>Version</dt><dd>{info?.version ?? "…"}</dd></div><div><dt>Architecture</dt><dd>{info?.arch ?? "…"}</dd></div><div><dt>Platform</dt><dd>{info?.platform ?? "…"}</dd></div><div><dt>Geometry</dt><dd>Manifold WASM booleans</dd></div><div><dt>Export</dt><dd>Binary STL + Bambu project 3MF</dd></div></dl>
        </article>
        <article className="panel settings-card danger-card">
          <div className="section-title"><div><span className="eyebrow">RECOVERY</span><h3>Restore bundled records</h3></div><RotateCcw size={20} /></div>
          <p>A timestamped backup is created before reset. This restores the S24+, S23 FE, A52s, and A52 regression records.</p>
          <button className="danger" onClick={() => void onReset()}><RotateCcw size={16} /> Reset local catalog</button>
        </article>
      </section>
      <section className="panel privacy-banner"><div className="brand-mark"><Smartphone size={20} /><Sparkles size={11} /></div><div><strong>Designed as a quiet tool.</strong><span>No login. No remote measurements. No uploads. Links in evidence records only open when you choose them.</span></div><span className="offline-badge"><span /> Offline-capable</span></section>
    </div>
  );
}
