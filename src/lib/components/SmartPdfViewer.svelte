<script lang="ts">
	let { url, name }: { url: string; name: string } = $props();
</script>

<div class="pdf-viewer">
	<iframe src={url} title={`Smart PDF ${name}`}></iframe>
</div>

<style>
	.pdf-viewer,
	iframe {
		width: 100%;
		height: 100%;
		min-width: 0;
		min-height: 0;
	}

	.pdf-viewer {
		background: #525659;
	}

	iframe {
		display: block;
		border: 0;
	}
</style>
