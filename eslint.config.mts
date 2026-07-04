// ESLint 配置 —— 基于 typescript-eslint,并叠加 Obsidian 官方推荐规则
import tseslint from 'typescript-eslint';
import obsidianmd from 'eslint-plugin-obsidianmd';
import globals from 'globals';
import { globalIgnores } from 'eslint/config';

export default tseslint.config(
	// 不参与 lint 的文件(构建产物、配置、锁定文件等)
	globalIgnores([
		'node_modules',
		'dist',
		'esbuild.config.mjs',
		'versions.json',
		'main.js',
		'package.json',
		'package-lock.json',
		'tsconfig.json',
		'.claude/hooks/*.js',         // git hooks 脚本(纯 Node.js,非 TS)
		'**/node_modules/**',
		'**/main.js',                 // esbuild 输出及 vault 同步副本
	]),
	{
		languageOptions: {
			globals: {
				...globals.browser, // 插件运行在 Obsidian 的浏览器/DOM 环境
			},
			parserOptions: {
				// 允许少量非标准 .ts/.json 走 default project,避免 type-aware 报错
				projectService: {
					allowDefaultProject: ['eslint.config.mts', 'manifest.json'],
				},
				tsconfigRootDir: import.meta.dirname,
				extraFileExtensions: ['.json'],
			},
		},
	},
	// Obsidian 官方推荐规则集(API 用法、内部访问等约束)
	...obsidianmd.configs.recommended,
	// 测试/桩文件豁免 obsidian 窗口兼容规则(jsdom 无 activeDocument/activeWindow)。
	// 用 config 级 override 代替逐文件 eslint-disable —— shipped 源码仍全量受约束。
	{
		files: ['**/*.test.ts', '__mocks__/**/*.ts'],
		rules: {
			'obsidianmd/no-global-this': 'off',
			'obsidianmd/prefer-active-doc': 'off',
		},
	},
);
