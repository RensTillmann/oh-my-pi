import * as os from "node:os";
import { Container, type SelectItem, SelectList, Spacer, Text } from "@oh-my-pi/pi-tui";
import { shortenPath } from "../../../tools/render-utils";
import { getSelectListTheme, theme } from "../../theme/theme";
import { DynamicBorder } from "../dynamic-border";

export class ExtensionEditorOptionPicker extends Container {
	#selectList: SelectList;

	constructor(
		filePath: string,
		options: SelectItem[],
		initialIndex: number,
		onSelect: (value: string) => void,
		onCancel: () => void,
	) {
		super();

		const visibleRows = Math.max(4, Math.min(8, options.length));
		const displayPath = shortenPath(filePath, os.homedir());

		this.addChild(new DynamicBorder());
		this.addChild(new Spacer(1));
		this.addChild(new Text(theme.fg("accent", "Choose edit method"), 1, 0));
		this.addChild(new Text(theme.fg("dim", ` ${displayPath}`), 1, 0));
		this.addChild(new Spacer(1));

		this.#selectList = new SelectList(options, visibleRows, getSelectListTheme());
		if (options.length > 0) {
			this.#selectList.setSelectedIndex(Math.max(0, Math.min(initialIndex, options.length - 1)));
		}

		this.#selectList.onSelect = item => {
			onSelect(String(item.value));
		};
		this.#selectList.onCancel = onCancel;

		this.addChild(this.#selectList);
		this.addChild(new Spacer(1));
		this.addChild(new Text(theme.fg("dim", " Enter: select  Esc: cancel"), 1, 0));
		this.addChild(new DynamicBorder());
	}

	getSelectList(): SelectList {
		return this.#selectList;
	}
}
