<!--
  A mark in a poster's top corner: watched, in the library, wished for. In
  rows shown scaled, it's sized by the row's scale (--row-scale) to read the
  same in every row.
-->
<script lang="ts">
  interface Props {
    sign: string
    /** What it means, on hovering */
    title: string
    corner?: 'left' | 'right'
  }
  let { sign, title, corner = 'right' }: Props = $props()
</script>

<span class="mark {corner}" {title}>{sign}</span>

<style>
  .mark {
    position: absolute;
    top: calc(6px / var(--row-scale));
    width: calc(22px / var(--row-scale));
    height: calc(22px / var(--row-scale));
    display: grid;
    place-items: center;
    border-radius: 50%;
    color: #fff;
    font-size: calc(13px / var(--row-scale));
    font-weight: 700;
    background: var(--glass), rgb(0 0 0 / 0.6);
    box-shadow: var(--glass-edge);
  }
  .right {
    right: calc(6px / var(--row-scale));
  }
  .left {
    left: calc(6px / var(--row-scale));
  }
</style>
