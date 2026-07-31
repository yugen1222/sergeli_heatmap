const {onValueWritten}=require("firebase-functions/v2/database");
const {setGlobalOptions}=require("firebase-functions/v2");
const admin=require("firebase-admin");

admin.initializeApp();
setGlobalOptions({region:"asia-southeast1",maxInstances:5});

function statusOf(data,settings){
  const staff=Number(data?.staff||0),guests=Number(data?.guests||0),norm=Number(data?.norm||1);
  const load=staff>0?guests/staff:0;
  if(load<=norm)return"green";
  if(load<=norm+Number(settings?.yellowLimit||1))return"yellow";
  return"red";
}

exports.sendFloorAlert=onValueWritten(
  {
    ref:"/sergeli_heatmap/floors/{floorId}",
    instance:"sergeli-heatmap-default-rtdb",
    region:"asia-southeast1"
  },
  async event=>{
    const before=event.data.before.val();
    const after=event.data.after.val();
    if(!after)return;

    const settingsSnap=await admin.database().ref("/sergeli_heatmap/settings").get();
    const settings=settingsSnap.val()||{};
    if(settings.pushEnabled==="Выключено")return;

    const oldStatus=statusOf(before,settings);
    const newStatus=statusOf(after,settings);
    if(newStatus!=="red"||oldStatus==="red")return;

    const floorId=event.params.floorId;
    const missing=Math.max(0,Math.ceil(Number(after.guests||0)/Math.max(1,Number(after.norm||1)))-Number(after.staff||0));

    const tokensSnap=await admin.database().ref("/sergeli_heatmap/pushTokens").get();
    const entries=tokensSnap.exists()?Object.entries(tokensSnap.val()):[];
    const tokens=entries.map(([,v])=>v.token).filter(Boolean);
    if(!tokens.length)return;

    const response=await admin.messaging().sendEachForMulticast({
      tokens,
      notification:{
        title:`🚨 Горит ${floorId} этаж`,
        body:`Не хватает +${missing} сотрудника. Гостей: ${after.guests}, сотрудников: ${after.staff}.`
      },
      data:{url:"https://sergeli-heatmap.onrender.com/"}
    });

    const removals={};
    response.responses.forEach((r,i)=>{
      if(!r.success){
        const code=r.error?.code||"";
        if(code.includes("registration-token-not-registered")||code.includes("invalid-registration-token")){
          const key=entries[i][0];
          removals[`/sergeli_heatmap/pushTokens/${key}`]=null;
        }
      }
    });
    if(Object.keys(removals).length)await admin.database().ref().update(removals);
  }
);
