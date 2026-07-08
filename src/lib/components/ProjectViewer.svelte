<script lang="ts">
	import ProjectShell from '$lib/components/ProjectShell.svelte';

	let { onCompare }: { onCompare: () => void } = $props();
</script>

<ProjectShell {onCompare} />
