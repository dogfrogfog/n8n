<script lang="ts" setup>
import type { Options as MarkdownOptions } from 'markdown-it';
import Markdown from 'markdown-it';
import markdownEmoji from 'markdown-it-emoji';
import markdownLink from 'markdown-it-link-attributes';
import markdownTaskLists from 'markdown-it-task-lists';
import { computed, ref } from 'vue';
import xss, { friendlyAttrValue, whiteList } from 'xss';

import { markdownYoutubeEmbed, YOUTUBE_EMBED_SRC_REGEX, type YoutubeEmbedConfig } from './youtube';
import { toggleCheckbox } from '../../utils/markdown';
import N8nLoading from '../N8nLoading';

interface IImage {
	id: string | number;
	url: string;
}

interface Options {
	markdown: MarkdownOptions;
	linkAttributes: markdownLink.Config;
	tasklists: markdownTaskLists.Config;
	youtube: YoutubeEmbedConfig;
}

interface MarkdownProps {
	content?: string | null;
	withMultiBreaks?: boolean;
	images?: IImage[];
	loading?: boolean;
	loadingBlocks?: number;
	loadingRows?: number;
	theme?: string;
	options?: Options;
}

const props = withDefaults(defineProps<MarkdownProps>(), {
	content: '',
	withMultiBreaks: false,
	images: () => [],
	loading: false,
	loadingBlocks: 2,
	loadingRows: 3,
	theme: 'markdown',
	options: () => ({
		markdown: {
			html: false,
			linkify: true,
			typographer: true,
			breaks: true,
		},
		linkAttributes: {
			attrs: {
				target: '_blank',
				rel: 'noopener',
			},
		},
		tasklists: {
			enabled: true,
			label: true,
			labelAfter: true,
		},
		youtube: {},
	}),
});

const editor = ref<HTMLDivElement | undefined>(undefined);

const { options } = props;
const md = new Markdown(options.markdown)
	.use(markdownLink, options.linkAttributes)
	.use(markdownEmoji)
	.use(markdownTaskLists, options.tasklists)
	.use(markdownYoutubeEmbed, options.youtube);

const xssWhiteList = {
	...whiteList,
	label: ['class', 'for'],
	iframe: [
		'width',
		'height',
		'src',
		'title',
		'frameborder',
		'allow',
		'referrerpolicy',
		'allowfullscreen',
	],
};

const htmlContent = computed(() => {
	if (!props.content) {
		return '';
	}

	const imageUrls: { [key: string]: string } = {};
	if (props.images) {
		props.images.forEach((image: IImage) => {
			if (!image) {
				// Happens if an image got deleted but the workflow
				// still has a reference to it
				return;
			}
			imageUrls[image.id] = image.url;
		});
	}

	const fileIdRegex = new RegExp('fileId:([0-9]+)');
	let contentToRender = props.content;
	if (props.withMultiBreaks) {
		contentToRender = contentToRender.replaceAll('\n\n', '\n&nbsp;\n');
	}
	const html = md.render(contentToRender);

	const safeHtml = xss(html, {
		onTagAttr(tag, name, value) {
			if (tag === 'img' && name === 'src') {
				if (value.match(fileIdRegex)) {
					const id = value.split('fileId:')[1];
					const attributeValue = friendlyAttrValue(imageUrls[id]);
					return attributeValue ? `src=${attributeValue}` : '';
				}
				// Only allow http requests to supported image files from the `static` directory
				const isImageFile = value.split('#')[0].match(/\.(jpeg|jpg|gif|png|webp)$/) !== null;
				const isStaticImageFile = isImageFile && value.startsWith('/static/');
				if (!value.startsWith('https://') && !isStaticImageFile) {
					return '';
				}
			}

			if (tag === 'iframe') {
				if (name === 'src') {
					// Only allow YouTube as src for iframes embeds
					if (YOUTUBE_EMBED_SRC_REGEX.test(value)) {
						return `src=${friendlyAttrValue(value)}`;
					} else {
						return '';
					}
				}
				return;
			}

			// Return nothing, means keep the default handling measure
			return;
		},
		onTag(tag, code) {
			if (tag === 'img' && code.includes('alt="workflow-screenshot"')) {
				return '';
			}
			// return nothing, keep tag
			return;
		},
		onIgnoreTag(tag, tagHTML) {
			// Allow checkboxes
			if (tag === 'input' && tagHTML.includes('type="checkbox"')) {
				return tagHTML;
			}
			return;
		},
		whiteList: xssWhiteList,
	});

	return safeHtml;
});

const emit = defineEmits<{
	'markdown-click': [link: HTMLAnchorElement, e: MouseEvent];
	'update-content': [content: string];
}>();

const onClick = (event: MouseEvent) => {
	let clickedLink: HTMLAnchorElement | null = null;

	if (event.target instanceof HTMLAnchorElement) {
		clickedLink = event.target;
	}

	if (event.target instanceof HTMLElement && event.target.matches('a *')) {
		const parentLink = event.target.closest('a');
		if (parentLink) {
			clickedLink = parentLink;
		}
	}
	if (clickedLink) {
		emit('markdown-click', clickedLink, event);
	}
};

// Handle checkbox changes
const onChange = async (event: Event) => {
	if (event.target instanceof HTMLInputElement && event.target.type === 'checkbox') {
		const checkboxes = editor.value?.querySelectorAll('input[type="checkbox"]');
		if (checkboxes) {
			// Get the index of the checkbox that was clicked
			const index = Array.from(checkboxes).indexOf(event.target);
			if (index !== -1) {
				onCheckboxChange(index);
			}
		}
	}
};

const onMouseDown = (event: MouseEvent) => {
	// Mouse down on input fields is caught by node view handlers
	// which prevents checking them, this will prevent that
	if (event.target instanceof HTMLInputElement) {
		event.stopPropagation();
	}
};

// Update markdown when checkbox state changes
const onCheckboxChange = (index: number) => {
	const currentContent = props.content;
	if (!currentContent) {
		return;
	}

	// We are using index to connect the checkbox with the corresponding line in the markdown
	const newContent = toggleCheckbox(currentContent, index);
	emit('update-content', newContent);
};
</script>

<template>
	<div class="n8n-markdown">
		<!-- Needed to support YouTube player embeds. HTML rendered here is sanitized. -->
		<!-- eslint-disable vue/no-v-html -->
		<div
			v-if="!loading"
			ref="editor"
			:class="$style[theme]"
			@click="onClick"
			@mousedown="onMouseDown"
			@change="onChange"
			v-html="htmlContent"
		/>
		<!-- eslint-enable vue/no-v-html -->
		<div v-else :class="$style.markdown">
			<div v-for="(_, index) in loadingBlocks" :key="index">
				<N8nLoading :loading="loading" :rows="loadingRows" animated variant="p" />
				<div :class="$style.spacer" />
			</div>
		</div>
	</div>
</template>

<style lang="scss" module>
.markdown {
	color: var(--color-text-base);

	* {
		font-size: var(--font-size-m);
		line-height: var(--font-line-height-xloose);
	}

	h1,
	h2,
	h3,
	h4 {
		margin-bottom: var(--spacing-s);
		font-size: var(--font-size-m);
		font-weight: var(--font-weight-bold);
	}

	h3,
	h4 {
		font-weight: var(--font-weight-bold);
	}

	p,
	span {
		margin-bottom: var(--spacing-s);
	}

	ul,
	ol {
		margin-bottom: var(--spacing-s);
		padding-left: var(--spacing-m);

		li {
			margin-top: 0.25em;
		}
	}

	pre > code {
		background-color: var(--color-background-base);
		color: var(--color-text-dark);
	}

	li > code,
	p > code {
		padding: 0 var(--spacing-4xs);
		color: var(--color-text-dark);
		background-color: var(--color-background-base);
	}

	.label {
		color: var(--color-text-base);
	}

	img {
		max-width: 100%;
		border-radius: var(--border-radius-large);
	}

	blockquote {
		padding-left: 10px;
		font-style: italic;
		border-left: var(--border-color-base) 2px solid;
	}
}

input[type='checkbox'] {
	accent-color: var(--color-primary);
}

input[type='checkbox'] + label {
	cursor: pointer;
}

.sticky {
	color: var(--color-sticky-font);
	overflow-wrap: break-word;

	h1,
	h2,
	h3,
	h4,
	h5,
	h6 {
		color: var(--color-sticky-font);
	}

	h1,
	h2,
	h3,
	h4 {
		margin-bottom: var(--spacing-2xs);
		font-weight: var(--font-weight-bold);
		line-height: var(--font-line-height-loose);
	}

	h1 {
		font-size: 36px;
	}

	h2 {
		font-size: 24px;
	}

	h3,
	h4,
	h5,
	h6 {
		font-size: var(--font-size-m);
	}

	p {
		margin-bottom: var(--spacing-2xs);
		font-size: var(--font-size-s);
		font-weight: var(--font-weight-regular);
		line-height: var(--font-line-height-loose);
	}

	ul,
	ol {
		margin-bottom: var(--spacing-2xs);
		padding-left: var(--spacing-m);

		li {
			margin-top: 0.25em;
			font-size: var(--font-size-s);
			font-weight: var(--font-weight-regular);
			line-height: var(--font-line-height-regular);
		}

		&:has(input[type='checkbox']) {
			list-style-type: none;
			padding-left: var(--spacing-5xs);
		}
	}

	pre > code {
		background-color: var(--color-sticky-code-background);
		color: var(--color-sticky-code-font);
	}

	pre > code,
	li > code,
	p > code {
		color: var(--color-sticky-code-font);
	}

	a {
		&:hover {
			text-decoration: underline;
		}
	}

	img {
		object-fit: contain;
		margin-top: var(--spacing-xs);
		margin-bottom: var(--spacing-2xs);

		&[src*='#full-width'] {
			width: 100%;
		}
	}
}

.sticky,
.markdown {
	pre {
		margin-bottom: var(--spacing-s);
		display: grid;
	}

	pre > code {
		display: block;
		padding: var(--spacing-s);
		overflow-x: auto;
	}

	iframe {
		aspect-ratio: 16/9 auto;
	}
}

.spacer {
	margin: var(--spacing-2xl);
}
</style>
