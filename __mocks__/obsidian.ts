/* eslint-disable @typescript-eslint/no-explicit-any,
                  @typescript-eslint/no-unsafe-assignment,
                  @typescript-eslint/no-unsafe-member-access
                  -- Vitest obsidian 包桩:mock API 表面需要 any 类型 */

/**
 * Vitest stub for the `obsidian` package.
 *
 * 仅暴露单元测试实际用到的表面:Modal、Setting、ColorComponent。
 * 如果新代码用到 obsidian 其他 API,在该处同步扩展。
 */

export class Modal {
  app: any;
  titleEl: { setText: (_: string) => void };
  contentEl: {
    createEl: (...args: any[]) => any;
    createDiv: (...args: any[]) => any;
    empty: () => void;
  };

  constructor(app: any) {
    this.app = app;
    this.titleEl = { setText: () => {} };
    this.contentEl = {
      createEl: () => ({}),
      createDiv: () => ({
        createEl: () => ({ addEventListener: () => {} }),
      }),
      empty: () => {},
    };
  }
  open(): void {}
  close(): void {}
  onOpen(): void {}
  onClose(): void {}
}

/** ColorPicker 风格的最小组件 */
export class ColorComponent {
  private _value = "#000000";
  private _onChange: ((v: string) => any) | null = null;
  getValue(): string { return this._value; }
  setValue(v: string): this { this._value = v; return this; }
  onChange(cb: (v: string) => any): this { this._onChange = cb; return this; }
  /** 测试 helper —— 触发注册的 onChange */
  fire(v: string): void { this._value = v; this._onChange?.(v); }
}

/** 输入框的最小 stub —— 记录最后一次值与 placeholder,fire() 触发 onChange */
export class TextComponent {
  private _value = "";
  private _placeholder = "";
  private _onChange: ((v: string) => any) | null = null;
  getValue(): string { return this._value; }
  setValue(v: string): this { this._value = v; return this; }
  setPlaceholder(p: string): this { this._placeholder = p; return this; }
  get placeholder(): string { return this._placeholder; }
  onChange(cb: (v: string) => any): this { this._onChange = cb; return this; }
  /** 测试 helper —— 模拟用户输入,触发注册的 onChange */
  fire(v: string): void { this._value = v; this._onChange?.(v); }
}

/** 按钮的最小 stub —— 记录 disabled/tooltip/icon/text/label,fire() 触发 onClick */
export class ButtonComponent {
  private _disabled = false;
  private _tooltip = "";
  private _icon = "";
  private _buttonText = "";
  private _cta = false;
  private _warning = false;
  private _onClick: (() => any) | null = null;
  /** buttonEl stub:记录 addClass 调用,便于断言 warning/destructive 样式类 */
  readonly buttonEl: { classes: string[]; addClass: (cls: string) => void } = {
    classes: [],
    addClass: (cls: string): void => {
      this.buttonEl.classes.push(cls);
    },
  };
  setDisabled(d: boolean): this { this._disabled = d; return this; }
  get disabled(): boolean { return this._disabled; }
  setTooltip(t: string): this { this._tooltip = t; return this; }
  get tooltip(): string { return this._tooltip; }
  setIcon(i: string): this { this._icon = i; return this; }
  get icon(): string { return this._icon; }
  setButtonText(t: string): this { this._buttonText = t; return this; }
  get buttonText(): string { return this._buttonText; }
  setCta(): this { this._cta = true; return this; }
  get cta(): boolean { return this._cta; }
  setWarning(): this { this._warning = true; return this; }
  get warning(): boolean { return this._warning; }
  onClick(cb: () => any): this { this._onClick = cb; return this; }
  /** 测试 helper —— 模拟点击,触发注册的 onClick */
  fire(): void { this._onClick?.(); }
}

/** Setting 链式 API 的最小 stub(只覆盖本任务需求) */
export class Setting {
  settingEl: any;
  controlEl: any;
  private _name = "";
  private _desc: unknown = "";

  static lastPicker: ColorComponent | null = null;
  static getLastPicker(): ColorComponent | null { return this.lastPicker; }

  /** 测试 helper —— 记录每次 addText/addButton 创建的组件(按创建顺序) */
  static lastTexts: TextComponent[] = [];
  static lastButtons: ButtonComponent[] = [];
  static resetCapture(): void {
    Setting.lastTexts = [];
    Setting.lastButtons = [];
  }

  constructor(_containerEl: HTMLElement) {
    this.settingEl = {
      prepend: (el: any) => {
        // 给测试用的 prepend 调用留个锚点
        (globalThis as any).__lastSwatchPrepended = el;
      },
    };
    this.controlEl = { appendChild: () => {} };
  }
  setName(name: string): this { this._name = name; return this; }
  setDesc(desc: any): this { this._desc = desc; return this; }
  setHeading(): this { return this; }
  get name(): string { return this._name; }
  get desc(): unknown { return this._desc; }
  addToggle(cb: (t: any) => any): this {
    const toggle = {
      setValue: (_v: boolean) => toggle,
      onChange: (_cb: (v: boolean) => any) => toggle,
    };
    cb(toggle);
    return this;
  }
  addColorPicker(cb: (cp: ColorComponent) => any): this {
    const cp = new ColorComponent();
    Setting.lastPicker = cp;
    cb(cp);
    return this;
  }
  addText(cb: (t: TextComponent) => any): this {
    const t = new TextComponent();
    Setting.lastTexts.push(t);
    cb(t);
    return this;
  }
  addButton(cb: (b: ButtonComponent) => any): this {
    const b = new ButtonComponent();
    Setting.lastButtons.push(b);
    cb(b);
    return this;
  }
}
