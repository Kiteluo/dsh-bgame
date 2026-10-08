window.__ModuleLoader__.load({
  id: 'dsh-bgame',
  factory: require => {
    const React = require('react');
    const h = React.createElement;
    const PANEL = 'dsh-bgame';
    const buttonStyle = { cursor:'pointer', border:'1px solid var(--dsw-alias-border-l2,#d8dedb)', borderRadius:6, padding:'8px 14px', color:'var(--dsw-alias-label-primary,#17251e)', background:'var(--dsw-alias-fill-l2,#f5f5f5)', font:'inherit', fontWeight:500 };
    function GameIcon({size=18}) {
      return h('svg',{width:size,height:size,viewBox:'0 0 24 24',fill:'none',stroke:'currentColor',strokeWidth:1.7,'aria-hidden':true},
        h('path',{d:'M7 7h10c2.5 0 4 3 5 9 .5 3-2.5 4-4.5 1.5L15.5 15h-7L6 17.5C4 20 1 19 1.5 16 2.5 10 4.5 7 7 7Z',strokeLinejoin:'round'}),
        h('path',{d:'M7 9.5v5m-2.5-2.5h5',strokeLinecap:'round'}),h('circle',{cx:16,cy:10.5,r:.8}),h('circle',{cx:18.5,cy:13,r:.8}));
    }
    function apply(ctx) {
      const open = () => ctx.layout.selectPanel(PANEL);
      function ArcadePanel() {
        const frame = React.useRef(null);
        React.useEffect(() => {
          const receive = event => {
            if (event.origin === location.origin && event.source === frame.current?.contentWindow && event.data?.type === 'dsh-bgame:return') ctx.layout.selectPanel(null);
          };
          window.addEventListener('message',receive);
          return () => window.removeEventListener('message',receive);
        },[]);
        return h('div',{'data-dsh-bgame-panel':true,style:{width:'100%',height:'100%',minHeight:0,overflow:'hidden'}},h('iframe',{
          ref:frame,src:new URL('./bgame/play',document.baseURI).href,title:'dsh-bgame · 游戏大厅',style:{display:'block',width:'100%',height:'100%',border:0},
        }));
      }
      const openButton = () => h('button',{type:'button',style:buttonStyle,onClick:open,'data-arcade-open':true},'打开游戏大厅');
      function DetailAction({subject}) { return subject?.pkg?.name === PANEL ? openButton() : null; }
      function ArcadeConfiguration({view}) {
        if(view === 'summary') return '四款小游戏，和电脑或模型对战。';
        return h('section',{'data-arcade-plugin-info':true,style:{padding:'18px 0',lineHeight:1.8}},
          h('h3',{style:{margin:'0 0 8px',fontSize:18}},'小游戏'),
          h('p',{style:{margin:'0 0 16px',color:'var(--dsw-alias-label-secondary,#607169)'}},'德州扑克、21 点、五子棋、UNO。支持电脑和模型对手，对局自动保存。'),openButton());
      }
      ctx.slots.inject('main',()=>ctx.slots.register({name:'main',key:PANEL},ArcadePanel));
      ctx.slots.inject('sidebar.panellist',()=>ctx.slots.register({name:'sidebar.panellist',id:PANEL,order:10,label:'dsh-bgame'},GameIcon));
      ctx.slots.inject('plugins.detail.actions',()=>ctx.slots.register({name:'plugins.detail.actions',id:PANEL,order:10},DetailAction));
      ctx.slots.inject('plugins.bundle.config',()=>ctx.slots.register({name:'plugins.bundle.config',key:PANEL},ArcadeConfiguration));
    }
    return {inject:['slots','layout'],apply};
  },
});
