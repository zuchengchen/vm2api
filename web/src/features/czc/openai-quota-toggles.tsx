import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { Vm } from '@/types/panel-vm'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { Switch } from '@/components/ui/switch'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { ConfirmDialog } from '@/components/confirm-dialog'
import {
  formatOpenaiCredits,
  validCreditsBalance,
  type OpenaiCreditsSnap,
} from '@/features/czc/openai-credits'
import { dashboardQueryOptions } from '@/features/overview/queries'
import { vmQueryOptions, vmsListQueryOptions } from '@/features/vm/queries'

type SettingsPayload = {
  auto_reset_credit_enabled?: boolean
  openai_credits_enabled?: boolean
  credits?: OpenaiCreditsSnap
  auto_reset?: { action?: string; reason?: string | null }
}

export function OpenaiQuotaToggles({
  vm,
  compact = false,
  onQuery,
  busy = false,
}: {
  vm: Vm
  compact?: boolean
  onQuery?: () => void
  busy?: boolean
}) {
  const qc = useQueryClient()
  const [confirm, setConfirm] = useState<'reset' | 'credits' | null>(null)
  const credits = vm.credits as OpenaiCreditsSnap
  const display = formatOpenaiCredits(credits)
  const exact = validCreditsBalance(credits)

  const refreshAll = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: vmQueryOptions(vm.id).queryKey }),
      qc.invalidateQueries({ queryKey: vmsListQueryOptions().queryKey }),
      qc.invalidateQueries({ queryKey: dashboardQueryOptions().queryKey }),
    ])
  }

  const patch = useMutation({
    mutationFn: (body: {
      auto_reset_credit_enabled?: boolean
      openai_credits_enabled?: boolean
    }) =>
      api<SettingsPayload>(
        `/api/panel/vms/${encodeURIComponent(vm.id)}/openai-quota/settings`,
        { method: 'POST', body: JSON.stringify(body) }
      ),
    onSuccess: async (data, body) => {
      setConfirm(null)
      await refreshAll()
      if (body.auto_reset_credit_enabled === true) {
        if (data?.auto_reset?.action === 'reset') {
          toast.success('已开启自动重置券，并消费了一张')
          return
        }
        if (
          data?.auto_reset?.action === 'skip' &&
          data.auto_reset.reason === 'no_credits'
        ) {
          toast.success('已开启自动使用重置券（当前没有可用券）')
          return
        }
        if (
          data?.auto_reset?.action === 'query_failed' ||
          data?.auto_reset?.action === 'reset_failed'
        ) {
          toast.warning('已开启自动使用重置券，但这次未能自动消费')
          return
        }
        toast.success('已开启自动使用重置券')
        return
      }
      if (body.auto_reset_credit_enabled === false) {
        toast.success('已关闭自动使用重置券')
        return
      }
      toast.success(
        body.openai_credits_enabled
          ? '已允许额度用尽后消耗点数'
          : '已关闭消耗点数'
      )
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const autoReset = vm.auto_reset_credit_enabled === true
  const creditsOn = vm.openai_credits_enabled === true
  const toggling = patch.isPending

  const requestToggle = (kind: 'reset' | 'credits', next: boolean) => {
    if (toggling) return
    if (next) {
      setConfirm(kind)
      return
    }
    if (kind === 'reset') patch.mutate({ auto_reset_credit_enabled: false })
    else patch.mutate({ openai_credits_enabled: false })
  }

  return (
    <div
      className={cn('flex flex-wrap items-center gap-1.5', !compact && 'gap-2')}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <button
        type='button'
        disabled={busy}
        title={
          exact && exact !== display
            ? `点数 ${exact}`
            : '点击查询 Codex 点数余额和重置券'
        }
        className={cn(
          'inline-flex max-w-full items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium text-emerald-700 transition-colors hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50 dark:text-emerald-400 dark:hover:bg-emerald-900/30',
          compact ? 'h-6' : 'h-7'
        )}
        onClick={() => onQuery?.()}
      >
        点数
        <span className='truncate tabular-nums'>{display}</span>
      </button>

      <ToggleSwitch
        compact={compact}
        checked={autoReset}
        disabled={toggling}
        label='自动券'
        title={`自动使用重置券：${autoReset ? '开' : '关'}\n额度用尽后自动消费 1 张上游重置券恢复窗口。`}
        onToggle={(next) => requestToggle('reset', next)}
      />
      <ToggleSwitch
        compact={compact}
        checked={creditsOn}
        disabled={toggling}
        label='用点数'
        title={`额度用尽后消耗点数：${creditsOn ? '开' : '关'}\n默认关闭。开启后套餐额度用尽仍继续调度，由上游扣除购买的点数。`}
        onToggle={(next) => requestToggle('credits', next)}
      />

      <ConfirmDialog
        open={confirm === 'reset'}
        onOpenChange={(open) => {
          if (!open) setConfirm(null)
        }}
        title='开启自动使用重置券？'
        desc='额度用尽后将自动消费 1 张上游重置券恢复窗口，不可退回。确认开启？'
        confirmText='确认开启'
        destructive
        isLoading={toggling}
        handleConfirm={() => patch.mutate({ auto_reset_credit_enabled: true })}
      />
      <ConfirmDialog
        open={confirm === 'credits'}
        onOpenChange={(open) => {
          if (!open) setConfirm(null)
        }}
        title='允许消耗点数？'
        desc='开启后，该槽套餐额度用尽时请求会继续发往上游，OpenAI 将扣除账号中购买的点数。确认开启？'
        confirmText='确认开启'
        destructive
        isLoading={toggling}
        handleConfirm={() => patch.mutate({ openai_credits_enabled: true })}
      />
    </div>
  )
}

function ToggleSwitch({
  compact,
  checked,
  disabled,
  label,
  title,
  onToggle,
}: {
  compact: boolean
  checked: boolean
  disabled: boolean
  label: string
  title: string
  onToggle: (next: boolean) => void
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            'inline-flex items-center gap-1 text-[11px] text-muted-foreground',
            compact ? 'h-6' : 'h-7'
          )}
        >
          <Switch
            checked={checked}
            disabled={disabled}
            onCheckedChange={onToggle}
            aria-label={title}
            className={compact ? 'h-4 w-7' : undefined}
          />
          {label}
        </span>
      </TooltipTrigger>
      <TooltipContent className='max-w-xs whitespace-pre-line'>
        {title}
      </TooltipContent>
    </Tooltip>
  )
}
